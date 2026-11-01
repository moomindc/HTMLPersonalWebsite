import { loadSettings, saveSettings, wireSettingsForm } from './settings.js';
import { initModelManager } from './model-manager.js';
import { initTranscript, getTranscriptText } from './transcript.js';
import { initChat } from './chat.js';
import { detectRuntime } from './llm.js';

async function init() {
  console.log('[App] Initialising TranscriptToLLM…');

  let settings    = loadSettings();
  console.log('[App] Loaded settings:', settings);
  const getSettings = () => settings;

  const runtime   = detectRuntime();
  const gpuBadge  = document.getElementById('gpu-badge');
  if (runtime === 'webllm') {
    gpuBadge.textContent = 'WebGPU \u2713';
    gpuBadge.className   = 'badge badge--cached';
    gpuBadge.title       = 'WebGPU available — GPU-accelerated models supported';
    console.log('[App] WebGPU available');
  } else {
    gpuBadge.textContent = 'WebGPU \u2717';
    gpuBadge.className   = 'badge badge--undownloaded';
    gpuBadge.title       = 'WebGPU not available — CPU/WebAssembly models only';
    console.log('[App] WebGPU NOT available — CPU/WASM fallback');
  }

  const adapter = initModelManager(settings, runtime);
  console.log('[App] ModelManager initialised');

  initTranscript();
  console.log('[App] Transcript module initialised');

  initChat(adapter, getTranscriptText, getSettings);
  console.log('[App] Chat module initialised');

  wireSettingsForm(getSettings, (updated) => {
    console.log('[App] Settings updated:', updated);
    settings = updated;
  });

  document.addEventListener('model:loaded', (e) => {
    console.log('[App] model:loaded event received — model:', e.detail?.model?.id,
      '| runtime:', e.detail?.adapter?.runtime);
  });

  console.log('[App] Init complete');
}

function showAppError(msg) {
  const el = document.getElementById('app-error');
  if (el) { el.textContent = msg; el.hidden = false; }
  console.error('[App] Init error:', msg);
}

init().catch(err => {
  console.error('[App] Uncaught init error:', err);
  showAppError(err.message);
});
