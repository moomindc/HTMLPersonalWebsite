import { LLMAdapter } from './llm.js';

export const MODEL_CATALOGUE = [
  {
    id: 'Llama-3.2-1B-Instruct',
    name: 'Llama 3.2 1B',
    desc: 'Lightweight & fast. Good for quick Q&A.',
    size: '~700 MB',
    runtime: 'webllm',
    webllmId: 'Llama-3.2-1B-Instruct-q4f32_1-MLC',
  },
  {
    id: 'Qwen2.5-1.5B-Instruct',
    name: 'Qwen 2.5 1.5B',
    desc: 'Strong reasoning, multilingual support.',
    size: '~1.1 GB',
    runtime: 'webllm',
    webllmId: 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC',
  },
  {
    id: 'Phi-3.5-mini-instruct',
    name: 'Phi-3.5 Mini',
    desc: 'Best quality. Requires ~2.2 GB VRAM.',
    size: '~2.2 GB',
    runtime: 'webllm',
    webllmId: 'Phi-3.5-mini-instruct-q4f16_1-MLC',
  },
  {
    id: 'SmolLM2-1.7B-Instruct',
    name: 'SmolLM2 1.7B',
    desc: 'CPU/WebAssembly — works without WebGPU.',
    size: '~1.0 GB',
    runtime: 'transformers',
    hfRepo: 'HuggingFaceTB/SmolLM2-1.7B-Instruct',
  },
];

const CACHE_STORE_KEY = 'ttl_cached';

function getCachedIds() {
  try {
    const ids = JSON.parse(localStorage.getItem(CACHE_STORE_KEY) || '[]');
    console.debug('[ModelManager] getCachedIds →', ids);
    return ids;
  } catch {
    console.warn('[ModelManager] getCachedIds: failed to parse localStorage, returning []');
    return [];
  }
}
function markCached(id) {
  const ids = getCachedIds();
  if (!ids.includes(id)) {
    localStorage.setItem(CACHE_STORE_KEY, JSON.stringify([...ids, id]));
    console.log('[ModelManager] markCached:', id);
  }
}
function markUncached(id) {
  localStorage.setItem(CACHE_STORE_KEY, JSON.stringify(getCachedIds().filter(i => i !== id)));
  console.log('[ModelManager] markUncached:', id);
}

export function initModelManager(settings, runtime) {
  console.log('[ModelManager] init — saved model:', settings.modelId, '| runtime:', runtime);

  const adapter    = new LLMAdapter();
  const listEl     = document.getElementById('model-list');
  const loadBtn    = document.getElementById('load-model-btn');
  const deleteBtn  = document.getElementById('delete-model-btn');
  const progressEl = document.getElementById('model-progress');
  const progressTxt= document.getElementById('model-progress-text');

  // Pre-select: fall back to SmolLM2 if saved model needs WebGPU but it's unavailable
  let savedId = settings.modelId;
  if (runtime === 'transformers') {
    const savedModel = MODEL_CATALOGUE.find(m => m.id === savedId);
    if (savedModel?.runtime === 'webllm') {
      console.log('[ModelManager] WebGPU unavailable — falling back from', savedId, 'to SmolLM2');
      savedId = 'SmolLM2-1.7B-Instruct';
    }
  }

  renderList(savedId);

  // Auto-load if the selected model is already cached locally
  const cachedAtStart = getCachedIds();
  if (cachedAtStart.includes(savedId)) {
    console.log('[ModelManager] Model', savedId, 'is cached — auto-loading (no button press needed)');
    // Small delay to let the UI finish rendering before load starts
    setTimeout(() => triggerLoad(savedId), 150);
  } else {
    console.log('[ModelManager] Model', savedId, 'is NOT cached — user must press Load Model');
  }

  function renderList(selectedId) {
    listEl.innerHTML = '';
    const cached = getCachedIds();
    console.log('[ModelManager] renderList — selected:', selectedId, '| cached:', cached);
    MODEL_CATALOGUE.forEach(model => {
      const isCompatible = runtime === 'webllm' || model.runtime === 'transformers';
      const isCached     = cached.includes(model.id);
      const isSelected   = model.id === selectedId;

      const label = document.createElement('label');
      label.className = 'model-card' + (isSelected ? ' model-card--selected' : '');
      label.htmlFor   = `model-radio-${model.id}`;

      label.innerHTML = `
        <input type="radio" id="model-radio-${model.id}" name="model" value="${model.id}"
          ${isSelected ? 'checked' : ''} ${!isCompatible ? 'disabled' : ''} />
        <div class="model-card__info">
          <span class="model-card__name">${model.name}</span>
          <span class="model-card__desc">${model.desc}${!isCompatible ? ' <span class="badge badge--undownloaded" title="WebGPU not available">WebGPU only</span>' : ''}</span>
        </div>
        <div class="model-card__meta">
          <span class="model-card__size">${model.size}</span>
          <span class="badge ${isCached ? 'badge--cached' : 'badge--undownloaded'}">${isCached ? 'Cached' : 'Not cached'}</span>
        </div>`;

      label.addEventListener('click', () => {
        document.querySelectorAll('.model-card').forEach(c => c.classList.remove('model-card--selected'));
        label.classList.add('model-card--selected');
        console.log('[ModelManager] User selected model:', model.id);
      });

      listEl.appendChild(label);
    });
  }

  function getSelectedId() {
    return listEl.querySelector('input[type="radio"]:checked')?.value ?? null;
  }

  function getStatusBadge(id) {
    return document.getElementById(`model-radio-${id}`)
      ?.closest('.model-card')
      ?.querySelector('.model-card__meta .badge');
  }

  function setProgress(value, text) {
    progressEl.value        = value;
    progressEl.hidden       = false;
    progressTxt.textContent = text;
    progressTxt.hidden      = false;
  }

  async function triggerLoad(id) {
    const model = MODEL_CATALOGUE.find(m => m.id === id);
    if (!model) {
      console.warn('[ModelManager] triggerLoad: model not found for id', id);
      return;
    }

    const isCachedLocally = getCachedIds().includes(id);
    console.log('[ModelManager] triggerLoad:', id,
      '| cached locally:', isCachedLocally,
      '| runtime:', model.runtime);

    loadBtn.disabled   = true;
    deleteBtn.disabled = true;
    setProgress(0, isCachedLocally ? 'Loading from cache…' : 'Starting download…');

    const badge = getStatusBadge(id);
    if (badge) { badge.className = 'badge badge--loading'; badge.textContent = 'Loading…'; }

    const t0 = performance.now();
    try {
      await adapter.load(model, (progress, text) => {
        setProgress(progress, text || `${Math.round(progress * 100)}%`);
      });

      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      console.log('[ModelManager] Model loaded successfully:', id,
        '| elapsed:', elapsed + 's',
        '| was cached:', isCachedLocally);

      markCached(id);
      if (badge) { badge.className = 'badge badge--cached'; badge.textContent = 'Cached'; }
      setProgress(1, 'Model ready');
      document.dispatchEvent(new CustomEvent('model:loaded', { detail: { adapter, model } }));
      console.log('[ModelManager] Dispatched model:loaded event for', id);
    } catch (err) {
      console.error('[ModelManager] Model load failed for', id, err);
      if (badge) { badge.className = 'badge badge--error'; badge.textContent = 'Error'; }
      setProgress(0, `Error: ${err.message}`);
      progressEl.hidden = true;
    } finally {
      loadBtn.disabled   = false;
      deleteBtn.disabled = false;
    }
  }

  loadBtn.addEventListener('click', () => {
    const id = getSelectedId();
    console.log('[ModelManager] Load button clicked — selected:', id);
    if (!id) { console.warn('[ModelManager] No model selected'); return; }
    triggerLoad(id);
  });

  deleteBtn.addEventListener('click', async () => {
    const id    = getSelectedId();
    const model = MODEL_CATALOGUE.find(m => m.id === id);
    if (!model) return;
    console.log('[ModelManager] Delete button clicked — model:', id);

    if (model.runtime === 'webllm') {
      try {
        console.log('[ModelManager] Deleting web-llm cache for', model.webllmId);
        const webllm = await import('@mlc-ai/web-llm');
        if (typeof webllm.deleteModelAllInfoInCache === 'function') {
          await webllm.deleteModelAllInfoInCache(model.webllmId);
          console.log('[ModelManager] web-llm cache deleted for', model.webllmId);
        } else {
          console.warn('[ModelManager] deleteModelAllInfoInCache not available in this version of web-llm');
        }
      } catch (err) {
        console.warn('[ModelManager] Could not delete web-llm cache:', err);
      }
    }

    markUncached(id);
    const badge = getStatusBadge(id);
    if (badge) { badge.className = 'badge badge--undownloaded'; badge.textContent = 'Not cached'; }
    setProgress(0, 'Removed from cache.');
    progressEl.hidden = true;
    console.log('[ModelManager] Cache cleared for', id);
  });

  // Disable Load button when offline and model not cached
  function syncOnline() {
    const online = navigator.onLine;
    console.debug('[ModelManager] syncOnline — online:', online);
    if (!online) {
      const cached = getCachedIds();
      const id = getSelectedId();
      if (id && !cached.includes(id)) {
        loadBtn.disabled = true;
        loadBtn.title    = 'No internet connection — cannot download models';
        console.log('[ModelManager] Offline & model not cached — Load button disabled');
      }
    } else {
      if (!loadBtn.closest('[disabled]')) {
        loadBtn.disabled = false;
        loadBtn.title    = '';
      }
    }
  }
  window.addEventListener('online',  syncOnline);
  window.addEventListener('offline', syncOnline);
  syncOnline();

  return adapter;
}
