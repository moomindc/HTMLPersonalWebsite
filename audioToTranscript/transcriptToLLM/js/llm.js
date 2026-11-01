export function detectRuntime() {
  const has = typeof navigator !== 'undefined' && 'gpu' in navigator;
  console.debug('[LLM] detectRuntime →', has ? 'webllm (WebGPU)' : 'transformers (CPU/WASM)');
  return has ? 'webllm' : 'transformers';
}

export class LLMAdapter {
  #engine   = null;
  #pipe     = null;
  #runtime  = null;
  #modelId  = null;

  async load(modelEntry, onProgress) {
    console.log('[LLMAdapter] load() called — model:', modelEntry.id, '| runtime:', modelEntry.runtime);
    this.#runtime = modelEntry.runtime;
    this.#modelId = modelEntry.id;
    this.#engine  = null;
    this.#pipe    = null;

    if (modelEntry.runtime === 'webllm') {
      console.log('[LLMAdapter] Importing @mlc-ai/web-llm…');
      const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
      console.log('[LLMAdapter] Creating MLC engine for', modelEntry.webllmId,
        '(browser GPU shader cache is automatic in Chrome/Edge)');
      this.#engine = await CreateMLCEngine(modelEntry.webllmId, {
        initProgressCallback: ({ progress, text }) => {
          console.debug('[LLMAdapter] webllm progress', Math.round(progress * 100) + '%', text ?? '');
          onProgress(progress, text ?? '');
        },
      });
      console.log('[LLMAdapter] MLC engine ready for', modelEntry.webllmId);
    } else {
      console.log('[LLMAdapter] Importing @huggingface/transformers…');
      const { pipeline, env } = await import('@huggingface/transformers');
      env.backends.onnx.wasm.numThreads = 1;
      console.log('[LLMAdapter] WASM threads:', env.backends.onnx.wasm.numThreads);
      console.log('[LLMAdapter] Building transformers pipeline for', modelEntry.hfRepo);
      this.#pipe = await pipeline('text-generation', modelEntry.hfRepo, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (p) => {
          if (p.status === 'progress') {
            console.debug('[LLMAdapter] transformers progress', Math.round(p.progress ?? 0) + '%', p.file ?? '');
            onProgress((p.progress ?? 0) / 100, p.file ?? '');
          } else if (p.status === 'done') {
            console.log('[LLMAdapter] transformers pipeline done');
            onProgress(1, 'Ready');
          } else {
            console.debug('[LLMAdapter] transformers status:', p.status, p.name ?? '');
          }
        },
      });
      console.log('[LLMAdapter] Transformers pipeline ready');
    }
  }

  async chat(messages, { temperature, maxTokens, onToken }) {
    if (!this.loaded) throw new Error('No model loaded.');
    console.log('[LLMAdapter] chat() — runtime:', this.#runtime,
      '| messages:', messages.length, '| temp:', temperature, '| maxTokens:', maxTokens);

    if (this.#runtime === 'webllm') {
      console.log('[LLMAdapter] Calling engine.chat.completions.create…');
      let tokenCount = 0;
      try {
        const stream = await this.#engine.chat.completions.create({
          messages,
          temperature,
          max_tokens: maxTokens,
          stream: true,
        });
        console.log('[LLMAdapter] Stream created, iterating…');
        let chunkCount = 0;
        for await (const chunk of stream) {
          chunkCount++;
          const delta = chunk.choices[0]?.delta?.content;
          if (chunkCount <= 3) console.debug('[LLMAdapter] raw chunk:', JSON.stringify(chunk));
          if (delta) { onToken(delta); tokenCount++; }
        }
        console.log('[LLMAdapter] loop done — total chunks:', chunkCount, '| token chunks:', tokenCount);
      } catch (streamErr) {
        const isFatal = /deleted object|disposed|device.*(lost|invalid)|invalid.*buffer/i.test(streamErr.message);
        if (isFatal) {
          this.#engine = null;
          throw new Error('GPU device lost — please reload the model and try again.');
        }
        console.warn('[LLMAdapter] Streaming failed, falling back to non-streaming:', streamErr.message, streamErr);
        const reply = await this.#engine.chat.completions.create({
          messages,
          temperature,
          max_tokens: maxTokens,
          stream: false,
        });
        const content = reply.choices[0]?.message?.content ?? '';
        if (content) { onToken(content); tokenCount++; }
      }
      console.log('[LLMAdapter] webllm complete — token chunks received:', tokenCount);
    } else {
      const { TextStreamer } = await import('@huggingface/transformers');
      const streamer = new TextStreamer(this.#pipe.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (text) => onToken(text),
      });
      console.log('[LLMAdapter] Running transformers pipeline…');
      await this.#pipe(messages, {
        max_new_tokens: maxTokens,
        temperature,
        do_sample: temperature > 0,
        streamer,
      });
      console.log('[LLMAdapter] Transformers pipeline complete');
    }
  }

  get loaded()  { return !!(this.#engine || this.#pipe); }
  get modelId() { return this.#modelId; }
  get runtime() { return this.#runtime; }
}
