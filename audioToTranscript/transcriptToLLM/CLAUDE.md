# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

No build step. Serve the directory with any static HTTP server:

```bash
python -m http.server 8080
# or
npx http-server .
```

Open in a modern browser — Chrome recommended for WebGPU support.

## Architecture

Single-page offline app: users upload/paste a transcript, then query it via a local LLM running entirely in the browser. No server, no cloud APIs, no build tooling.

**Entry point:** `index.html` → `js/app.js`

**Module responsibilities:**
- `app.js` — Initializes all modules and wires them together
- `llm.js` — Adapter pattern over two runtimes: `@mlc-ai/web-llm` (WebGPU/GPU) and `@huggingface/transformers` (CPU/WASM)
- `model-manager.js` — Hardcoded 4-model catalog; handles download, cache tracking (localStorage), deletion
- `transcript.js` — File upload (5 MB limit), text chunking (fixed-size with overlap), keyword-based retrieval
- `chat.js` — Prompt construction (system prompt + retrieved chunks + user query), streaming token output
- `settings.js` — Persistence to localStorage under key `ttl_settings`

**Data flow:**
```
Upload/paste transcript → chunk text
User question → keyword-score chunks → top-5 retrieved
Build prompt → LLM adapter → stream tokens to chat UI
```

**Cross-module communication:** modules export init functions; `model:loaded` CustomEvent signals the chat module (enables Send button) when a model is ready.

**Auto-load:** on startup, `model-manager.js` checks localStorage and auto-loads the previously selected model if it's already cached (150 ms delay to let the UI render first).

**Full-text bypass:** `chat.js:buildContext()` sends the entire transcript when it is ≤ 8000 chars. Chunking + keyword retrieval only kicks in for longer transcripts.

**localStorage keys:**
- `ttl_settings` — all user settings (chunk size, overlap, temperature, system prompt, max tokens, selected model ID)
- `ttl_cached` — JSON array of model IDs that have been downloaded to IndexedDB

## Key Constraints

- **No semantic search** — retrieval is simple word-frequency scoring, intentionally lightweight
- **Libraries loaded from CDN** via importmap in `index.html` — no npm, no bundler
- **Models are large** (700 MB–2.2 GB) and cached in browser IndexedDB — test model management carefully
- Default context window cap: 8000 chars; default chunk size: 2000 chars / 200 char overlap; default temperature: 0.3
- WebGPU models (webllm runtime) are deleted via `webllm.deleteModelAllInfoInCache()`; the transformers (CPU) model has no programmatic cache-delete path in the current code
