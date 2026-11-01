/**
 * worker.js
 * Web Worker that runs Transformers.js Whisper inference off the main thread.
 *
 * Message protocol — Main → Worker:
 *   { type: 'load_model', modelId: string, options: object }
 *   { type: 'transcribe', audio: Float32Array, options: object }
 *
 * Message protocol — Worker → Main:
 *   { type: 'download_progress', file: string, progress: number }  // 0..1
 *   { type: 'model_loading' }
 *   { type: 'model_ready', modelId: string }
 *   { type: 'transcribing' }
 *   { type: 'result', text: string, chunks: array|null }
 *   { type: 'error', message: string }
 */

import {
  pipeline,
  env,
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/dist/transformers.min.js';

// Use Hugging Face Hub for model downloads; browser Cache API handles caching automatically
env.allowLocalModels = false;
env.useBrowserCache = true;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** The currently loaded pipeline, or null. */
let currentPipe = null;
/** The model ID that currentPipe was created for. */
let currentModelId = null;
/** The device the current pipeline is running on ('webgpu' | 'wasm'). */
let currentDevice = null;
/** True while a load or transcription is in progress. */
let busy = false;

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.addEventListener('message', async (event) => {
  const { type, modelId, audio, options } = event.data;

  if (type === 'load_model') {
    await handleLoadModel(modelId, options);
  } else if (type === 'transcribe') {
    await handleTranscribe(audio, options);
  }
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleLoadModel(modelId, options = {}) {
  if (busy) return;

  // If the requested model is already loaded, just confirm ready
  if (currentPipe && currentModelId === modelId) {
    self.postMessage({ type: 'model_ready', modelId });
    return;
  }

  busy = true;
  self.postMessage({ type: 'model_loading' });

  try {
    const preferWebGPU = options?.preferWebGPU ?? false;
    const device = await resolveDevice(preferWebGPU);
    console.debug('[worker] model load — device:', device, '| modelId:', modelId);

    const baseOptions = {
      progress_callback: (progressInfo) => {
        if (
          progressInfo.status === 'downloading' ||
          progressInfo.status === 'progress'
        ) {
          self.postMessage({
            type: 'download_progress',
            file: progressInfo.file || '',
            progress: progressInfo.progress != null ? progressInfo.progress / 100 : 0,
          });
        }
      },
    };

    let pipe = null;
    let actualDevice = device;

    if (device === 'webgpu') {
      pipe = await loadPipelineWithTimeout(
        modelId,
        { ...baseOptions, device: 'webgpu', dtype: 'fp16' },
        45_000
      ).catch((err) => {
        console.warn('[worker] WebGPU load failed or timed out, falling back to WASM:', err.message);
        return null;
      });
      if (!pipe) {
        actualDevice = 'wasm';
        pipe = await pipeline('automatic-speech-recognition', modelId, { ...baseOptions, device: 'wasm' });
      }
    } else {
      pipe = await pipeline('automatic-speech-recognition', modelId, { ...baseOptions, device: 'wasm' });
    }

    currentPipe = pipe;
    currentModelId = modelId;
    currentDevice = actualDevice;
    self.postMessage({ type: 'model_ready', modelId, device: actualDevice });
  } catch (err) {
    currentPipe = null;
    currentModelId = null;
    self.postMessage({ type: 'error', message: `Failed to load model: ${err.message}` });
  } finally {
    busy = false;
  }
}

async function handleTranscribe(audio, options = {}) {
  if (busy) {
    self.postMessage({ type: 'error', message: 'A transcription is already in progress.' });
    return;
  }
  if (!currentPipe) {
    self.postMessage({ type: 'error', message: 'No model is loaded. Please wait for the model to finish loading.' });
    return;
  }

  busy = true;
  self.postMessage({ type: 'transcribing' });

  try {
    const CHUNK_S = 30;
    const STRIDE_S = 5;
    const SAMPLE_RATE = 16_000;
    // Effective audio covered per chunk (non-overlapping portion)
    const effectiveSamplesPerChunk = (CHUNK_S - STRIDE_S) * SAMPLE_RATE;
    const estimatedChunks = Math.max(1, Math.ceil(audio.length / effectiveSamplesPerChunk));
    let processedChunks = 0;

    console.debug('[worker] transcribe start — samples:', audio.length,
      '| duration:', (audio.length / SAMPLE_RATE).toFixed(1) + 's',
      '| estimated chunks:', estimatedChunks,
      '| options:', options);

    // Per-token heartbeat — fires every 20 tokens to confirm chunk 1 is alive
    let tokenCount = 0;
    let chunkStartTime = performance.now();

    // Build inference options from user settings
    const inferenceOpts = {
      // Return timestamps when requested
      return_timestamps: options.timestamps ? 'word' : false,
      // Chunk audio for long files to avoid OOM
      chunk_length_s: CHUNK_S,
      stride_length_s: STRIDE_S,
      // Called by Transformers.js per generated token — confirms inference is running
      callback_function: (beams) => {
        tokenCount++;
        if (tokenCount % 20 === 0) {
          const elapsedSec = ((performance.now() - chunkStartTime) / 1000).toFixed(1);
          console.debug(`[worker] chunk ${processedChunks + 1} in progress — tokens: ${tokenCount}, elapsed: ${elapsedSec}s`);
        }
      },
      // Called by Transformers.js after each audio chunk is decoded
      chunk_callback: (chunk) => {
        const chunkElapsed = ((performance.now() - chunkStartTime) / 1000).toFixed(2);
        processedChunks++;
        const progress = Math.min(processedChunks / estimatedChunks, 0.99);
        console.debug(`[worker] chunk ${processedChunks}/${estimatedChunks} COMPLETE — took ${chunkElapsed}s, tokens: ${tokenCount}, text preview: "${(chunk?.text || '').slice(0, 60)}"`);
        // Reset per-chunk counters
        tokenCount = 0;
        chunkStartTime = performance.now();
        self.postMessage({ type: 'transcription_progress', progress });
      },
    };

    // English-only models (*.en) do not support `language` or `task` params
    const isMultilingual = currentModelId &&
      !currentModelId.endsWith('.en') &&
      !currentModelId.includes('distil-whisper');
    if (isMultilingual) {
      if (options.language && options.language !== 'auto') {
        inferenceOpts.language = options.language;
      }
      if (options.task) {
        inferenceOpts.task = options.task; // 'transcribe' | 'translate'
      }
    }

    console.debug('[worker] calling pipeline — device:', currentDevice,
      '| chunk 1 starting now… (encoder may take several seconds on first run)');
    const pipelineStart = performance.now();

    // Interval heartbeat: if no token callbacks fire, confirms encoder is stuck (not silently errored)
    const heartbeatInterval = setInterval(() => {
      const elapsed = ((performance.now() - pipelineStart) / 1000).toFixed(1);
      console.warn(`[worker] ⏳ pipeline still awaiting after ${elapsed}s — device: ${currentDevice}, tokens so far: ${tokenCount}`);
    }, 5000);

    let result;
    try {
      result = await currentPipe(audio, inferenceOpts);
    } finally {
      clearInterval(heartbeatInterval);
    }

    const totalElapsed = ((performance.now() - pipelineStart) / 1000).toFixed(2);
    console.debug('[worker] transcription complete — text length:', result.text?.length ?? 0,
      '| total time:', totalElapsed + 's',
      '| chunks processed:', processedChunks);

    let text = result.text || '';

    // Optional whitespace cleanup
    if (options.cleanupWhitespace) {
      text = text.replace(/\s+/g, ' ').trim();
    }

    self.postMessage({
      type: 'result',
      text,
      chunks: result.chunks || null,
    });
  } catch (err) {
    self.postMessage({ type: 'error', message: `Transcription failed: ${err.message}` });
  } finally {
    busy = false;
  }
}

// ---------------------------------------------------------------------------
// Device resolution
// ---------------------------------------------------------------------------

/**
 * Load a pipeline and reject if it takes longer than timeoutMs.
 * Prevents indefinite hangs when a WebGPU driver stalls during model setup.
 * @param {string} modelId
 * @param {object} options  — passed directly to pipeline()
 * @param {number} timeoutMs
 * @returns {Promise<object>}  resolves with pipeline instance
 */
async function loadPipelineWithTimeout(modelId, options, timeoutMs) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`WebGPU model load timed out after ${timeoutMs / 1000}s`)),
      timeoutMs
    );
  });
  try {
    return await Promise.race([
      pipeline('automatic-speech-recognition', modelId, options),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Determine the best available inference device.
 * Tries WebGPU first (checking shader-f16 support); falls back to WASM (CPU).
 * @param {boolean} tryWebGPU
 * @returns {Promise<'webgpu'|'wasm'>}
 */
async function resolveDevice(tryWebGPU) {
  if (tryWebGPU && typeof navigator !== 'undefined' && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        const gpuDevice = await adapter.requestDevice();
        const hasFp16 = gpuDevice.features.has('shader-f16');
        gpuDevice.destroy();
        if (hasFp16) return 'webgpu';
        console.debug('[worker] WebGPU adapter found but shader-f16 not supported — using WASM');
      }
    } catch {
      // WebGPU not usable
    }
  }
  return 'wasm';
}
