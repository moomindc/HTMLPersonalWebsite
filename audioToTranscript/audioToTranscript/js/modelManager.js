/**
 * modelManager.js
 * Manages model cache status detection and coordinates model loading
 * via the transcription Web Worker.
 */

/**
 * Check which models in the registry are already cached in the browser.
 * Uses the Cache API that Transformers.js writes to automatically.
 * Returns a new array with the `cached` field updated on each entry.
 *
 * @param {Array<object>} registry - MODEL_REGISTRY array
 * @returns {Promise<Array<object>>}
 */
export async function checkCachedModels(registry) {
  if (!('caches' in window)) {
    // Cache API not available — assume nothing cached
    return registry.map((m) => ({ ...m, cached: false }));
  }

  // Transformers.js stores files under cache names that include the model URL path
  // We probe for known weight filenames as a heuristic
  const cacheNames = await caches.keys();

  return Promise.all(
    registry.map(async (model) => {
      const cached = await isModelCached(model.id, cacheNames);
      return { ...model, cached };
    })
  );
}

/**
 * Probe the Cache API to determine if a model's primary weight file is present.
 * Transformers.js caches files at URLs like:
 *   https://huggingface.co/Xenova/whisper-base.en/resolve/main/onnx/encoder_model.onnx
 *
 * We look for any cache entry whose URL contains the model's HF repo path.
 *
 * @param {string} modelId  e.g. "Xenova/whisper-base.en"
 * @param {string[]} cacheNames
 * @returns {Promise<boolean>}
 */
async function isModelCached(modelId, cacheNames) {
  try {
    for (const name of cacheNames) {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      // Check whether any cached URL belongs to this model
      const found = keys.some((req) =>
        req.url.includes(encodeURIComponent(modelId)) ||
        req.url.includes(modelId.replace('/', '/'))
      );
      if (found) return true;
    }
  } catch {
    // Ignore storage access errors
  }
  return false;
}

// ---------------------------------------------------------------------------
// Worker interface
// ---------------------------------------------------------------------------

let _worker = null;
let _pendingLoad = null;    // { resolve, reject, modelId }

/**
 * Set the Web Worker instance to communicate with.
 * Called once during app initialisation.
 * @param {Worker} worker
 */
export function setWorker(worker) {
  _worker = worker;
}

/**
 * Request the worker to load a model.
 * Resolves when the worker confirms `model_ready`.
 * Rejects if the worker reports an error during load.
 *
 * @param {string} modelId
 * @returns {Promise<void>}
 */
export function loadModel(modelId) {
  return new Promise((resolve, reject) => {
    _pendingLoad = { resolve, reject, modelId };
    _worker.postMessage({ type: 'load_model', modelId, options: { preferWebGPU: true } });
  });
}

/**
 * Resolve or reject a pending load based on a worker message.
 * Called by app.js when processing worker messages related to model loading.
 *
 * @param {{ type: string, modelId?: string, message?: string }} msg
 * @returns {boolean} true if the message was consumed
 */
export function handleWorkerMessage(msg) {
  if (!_pendingLoad) return false;

  if (msg.type === 'model_ready' && msg.modelId === _pendingLoad.modelId) {
    _pendingLoad.resolve();
    _pendingLoad = null;
    return true;
  }

  if (msg.type === 'error') {
    _pendingLoad.reject(new Error(msg.message));
    _pendingLoad = null;
    return true;
  }

  return false;
}
