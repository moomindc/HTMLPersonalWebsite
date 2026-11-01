/**
 * app.js
 * Application entry point.
 * Initialises all modules, wires UI events, manages runtime state, and
 * drives a single render() pass whenever state changes.
 */

import { MODEL_REGISTRY, DEFAULT_MODEL_ID, getModelById } from './modelRegistry.js';
import { loadSettings, saveSettings } from './settings.js';
import { validateFile, decodeAudio } from './audioProcessor.js';
import { copyToClipboard } from './clipboardManager.js';
import { checkCachedModels, setWorker, loadModel, handleWorkerMessage } from './modelManager.js';

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

const state = {
  // File
  selectedFile: null,
  fileError: null,
  // Model
  modelRegistry: MODEL_REGISTRY.map((m) => ({ ...m })),
  modelStatus: 'idle',          // 'idle' | 'loading' | 'ready' | 'error'
  downloadProgress: {},         // { [file]: 0..1 }
  downloadOverall: 0,           // 0..1 aggregate
  modelError: null,
  activeDevice: null,   // 'webgpu' | 'wasm' | null — set when model_ready fires
  // Transcription
  transcriptionStatus: 'idle',  // 'idle' | 'decoding' | 'transcribing' | 'done' | 'error'
  transcriptionProgress: 0,     // 0..1 — chunk-level progress during inference
  transcriptText: '',
  transcriptionError: null,
  // Clipboard
  copyFeedback: null,           // null | 'copied' | 'failed'
  // Settings (loaded from cookie)
  settings: null,
};

// ---------------------------------------------------------------------------
// DOM references (resolved once on DOMContentLoaded)
// ---------------------------------------------------------------------------

let dom = {};

// ---------------------------------------------------------------------------
// Web Worker
// ---------------------------------------------------------------------------

let worker = null;

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  resolveDom();
  wireEvents();

  // Load settings from cookie
  state.settings = loadSettings();

  // Check which models are cached before rendering model list
  state.modelRegistry = await checkCachedModels(state.modelRegistry);

  // Spin up the Web Worker
  worker = new Worker('./js/worker.js', { type: 'module' });
  setWorker(worker);
  worker.addEventListener('message', onWorkerMessage);
  worker.addEventListener('error', (e) => {
    setStatus('error', `Worker error: ${e.message}`);
  });

  // Initial render
  render();

  // Immediately begin loading the user's preferred model
  triggerModelLoad(state.settings.selectedModel);
});

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

function wireEvents() {
  // File upload — input button
  dom.fileInput.addEventListener('change', onFileSelected);

  // Model selection radio buttons — delegate from container
  dom.modelList.addEventListener('change', onModelChanged);

  // Options panel — handled natively by <details>, but we save settings on change
  dom.optionsForm.addEventListener('change', onOptionChanged);

  // Transcribe button
  dom.transcribeBtn.addEventListener('click', onTranscribe);

  // Copy button
  dom.copyBtn.addEventListener('click', onCopy);
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

function onFileSelected(e) {
  const file = e.target.files?.[0] ?? null;
  state.selectedFile = null;
  state.fileError = null;
  state.transcriptText = '';
  state.transcriptionStatus = 'idle';
  state.transcriptionProgress = 0;
  state.transcriptionError = null;
  state.copyFeedback = null;

  if (!file) {
    render();
    return;
  }

  try {
    validateFile(file);
    state.selectedFile = file;
    console.debug('[app] file selected:', file.name, `(${(file.size / 1_048_576).toFixed(2)} MB)`, 'type:', file.type);
  } catch (err) {
    state.fileError = err.message;
    console.debug('[app] file validation error:', err.message);
  }

  render();
}

function onModelChanged(e) {
  if (e.target.name !== 'model') return;
  const modelId = e.target.value;
  state.settings.selectedModel = modelId;
  saveSettings(state.settings);
  // Reset transcript when model changes
  state.transcriptText = '';
  state.transcriptionStatus = 'idle';
  state.transcriptionError = null;
  state.copyFeedback = null;
  render();
  triggerModelLoad(modelId);
}

function onOptionChanged(e) {
  const el = e.target;
  if (el.name === 'language') state.settings.language = el.value;
  else if (el.name === 'task') state.settings.task = el.value;
  else if (el.name === 'timestamps') state.settings.timestamps = el.checked;
  else if (el.name === 'cleanupWhitespace') state.settings.cleanupWhitespace = el.checked;
  else if (el.name === 'autoCopy') state.settings.autoCopy = el.checked;
  saveSettings(state.settings);
  render();
}

async function onTranscribe() {
  if (!canTranscribe()) return;

  state.transcriptionStatus = 'decoding';
  state.transcriptionProgress = 0;
  state.transcriptText = '';
  state.transcriptionError = null;
  state.copyFeedback = null;
  console.debug('[app] transcription started — file:', state.selectedFile.name, '| model:', state.settings.selectedModel);
  render();

  try {
    // Decode audio in the main thread (fast enough; keeps worker focused on inference)
    const audio = await decodeAudio(state.selectedFile, (progress) => {
      // Update status label during decode
      dom.statusText.textContent = `Decoding audio… ${Math.round(progress * 100)}%`;
      console.debug('[app] decode progress:', Math.round(progress * 100) + '%');
    });

    console.debug('[app] audio decoded — samples:', audio.length, '| duration:', (audio.length / 16000).toFixed(1) + 's');
    state.transcriptionStatus = 'transcribing';
    render();

    // Send decoded audio to Worker for inference
    worker.postMessage(
      {
        type: 'transcribe',
        audio,
        options: {
          language: state.settings.language,
          task: state.settings.task,
          timestamps: state.settings.timestamps,
          cleanupWhitespace: state.settings.cleanupWhitespace,
        },
      },
      [audio.buffer]   // Transfer ownership to avoid copying
    );
  } catch (err) {
    state.transcriptionStatus = 'error';
    state.transcriptionError = err.message;
    render();
  }
}

async function onCopy() {
  if (!state.transcriptText) return;
  const result = await copyToClipboard(state.transcriptText);
  state.copyFeedback = result.success ? 'copied' : 'failed';
  render();

  // Clear feedback after 3 seconds
  setTimeout(() => {
    state.copyFeedback = null;
    render();
  }, 3000);
}

// ---------------------------------------------------------------------------
// Worker message handling
// ---------------------------------------------------------------------------

function onWorkerMessage(event) {
  const msg = event.data;

  switch (msg.type) {
    case 'model_loading':
      console.debug('[app] worker → model_loading');
      state.modelStatus = 'loading';
      state.modelError = null;
      state.downloadProgress = {};
      state.downloadOverall = 0;
      render();
      break;

    case 'download_progress': {
      state.downloadProgress[msg.file] = msg.progress;
      // Compute simple average across all tracked files
      const values = Object.values(state.downloadProgress);
      state.downloadOverall = values.length
        ? values.reduce((a, b) => a + b, 0) / values.length
        : 0;
      console.debug(`[app] worker → download_progress — ${msg.file}: ${Math.round(msg.progress * 100)}% | overall: ${Math.round(state.downloadOverall * 100)}%`);
      render();
      break;
    }

    case 'model_ready':
      console.debug('[app] worker → model_ready — modelId:', msg.modelId, '| device:', msg.device);
      state.modelStatus = 'ready';
      state.activeDevice = msg.device || null;
      state.downloadProgress = {};
      state.downloadOverall = 0;
      // Mark this model as cached in the registry
      state.modelRegistry = state.modelRegistry.map((m) =>
        m.id === msg.modelId ? { ...m, cached: true } : m
      );
      render();
      // Resolve the loadModel() promise in modelManager
      handleWorkerMessage(msg);
      break;

    case 'transcribing':
      console.debug('[app] worker → transcribing');
      state.transcriptionStatus = 'transcribing';
      state.transcriptionProgress = 0;
      render();
      break;

    case 'transcription_progress':
      state.transcriptionProgress = msg.progress;
      render();
      break;

    case 'result':
      console.debug('[app] worker → result — text length:', msg.text?.length ?? 0, '| chunks:', msg.chunks?.length ?? 0);
      state.transcriptionStatus = 'done';
      state.transcriptionProgress = 1;
      state.transcriptText = msg.text;
      render();
      // Auto-copy if enabled
      if (state.settings.autoCopy && msg.text) {
        copyToClipboard(msg.text).then((r) => {
          state.copyFeedback = r.success ? 'copied' : 'failed';
          render();
        });
      }
      break;

    case 'error':
      console.debug('[app] worker → error:', msg.message);
      // Let modelManager handle load errors; if not consumed, treat as transcription error
      if (!handleWorkerMessage(msg)) {
        if (state.transcriptionStatus === 'transcribing') {
          state.transcriptionStatus = 'error';
          state.transcriptionError = msg.message;
        } else {
          state.modelStatus = 'error';
          state.modelError = msg.message;
        }
        render();
      }
      break;

    default:
      // Allow modelManager to handle model_ready / error promises
      handleWorkerMessage(msg);
  }
}

// ---------------------------------------------------------------------------
// Model loading
// ---------------------------------------------------------------------------

async function triggerModelLoad(modelId) {
  console.debug('[app] triggerModelLoad — modelId:', modelId, '| current status:', state.modelStatus);
  if (state.modelStatus === 'loading') return;
  if (state.modelStatus === 'ready' && /* same model */ true) {
    // Worker holds a pipeline; if same model already loaded nothing to do
    // We always reload if the ID differs — worker handles dedup
  }

  state.modelStatus = 'loading';
  state.modelError = null;
  render();

  try {
    await loadModel(modelId);
    // model_ready message will update state via onWorkerMessage
  } catch (err) {
    state.modelStatus = 'error';
    state.modelError = err.message;
    render();
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/**
 * Single render pass — reads state, updates DOM.
 * No direct DOM writes outside this function.
 */
function render() {
  const { settings, modelRegistry, modelStatus, transcriptionStatus } = state;

  // --- Model list ---
  renderModelList(modelRegistry, settings.selectedModel, modelStatus);

  // --- Status area ---
  renderStatus();

  // --- Options form ---
  restoreOptions(settings);

  // --- Transcribe button ---
  dom.transcribeBtn.disabled = !canTranscribe();
  dom.transcribeBtn.setAttribute(
    'aria-label',
    canTranscribe() ? 'Start transcription' : 'Transcribe (not ready)'
  );

  // --- Warning indicators ---
  dom.fileWarning.hidden = !!state.selectedFile;
  dom.modelWarning.hidden = state.modelStatus === 'ready';

  // --- File info ---
  if (state.selectedFile) {
    dom.fileInfo.textContent = formatFileInfo(state.selectedFile);
    dom.fileInfo.hidden = false;
  } else {
    dom.fileInfo.hidden = true;
  }

  // --- File error ---
  if (state.fileError) {
    showError(dom.fileError, state.fileError);
  } else {
    hideError(dom.fileError);
  }

  // --- Transcript ---
  dom.transcriptArea.value = state.transcriptText;

  // --- Transcription error ---
  if (state.transcriptionError) {
    showError(dom.transcriptionError, state.transcriptionError);
  } else {
    hideError(dom.transcriptionError);
  }

  // --- Model error ---
  if (state.modelError) {
    showError(dom.modelError, state.modelError);
  } else {
    hideError(dom.modelError);
  }

  // --- Copy button ---
  const hasTranscript = !!state.transcriptText;
  dom.copyBtn.disabled = !hasTranscript;
  dom.copyBtn.textContent = state.copyFeedback === 'copied'
    ? 'Copied!'
    : state.copyFeedback === 'failed'
      ? 'Copy failed — select text manually'
      : 'Copy to Clipboard';
  dom.copyBtn.classList.toggle('success', state.copyFeedback === 'copied');
  dom.copyBtn.classList.toggle('failure', state.copyFeedback === 'failed');

  // --- Options: hide translate task if model doesn't support it ---
  const model = getModelById(settings.selectedModel);
  if (model) {
    dom.taskTranslate.disabled = !model.supportsTranslation;
    if (!model.supportsTranslation && settings.task === 'translate') {
      state.settings.task = 'transcribe';
      dom.taskTranscribe.checked = true;
    }
  }
}

function renderModelList(registry, selectedId, modelStatus) {
  dom.modelList.innerHTML = '';

  for (const model of registry) {
    const isSelected = model.id === selectedId;

    // Determine badge text
    let badgeText = 'Not downloaded';
    let badgeClass = 'badge--undownloaded';
    if (model.cached) {
      badgeText = 'Cached';
      badgeClass = 'badge--cached';
    }
    if (isSelected && modelStatus === 'loading') {
      badgeText = 'Loading…';
      badgeClass = 'badge--loading';
    }
    if (isSelected && modelStatus === 'ready') {
      badgeText = 'Ready';
      badgeClass = 'badge--ready';
    }

    const item = document.createElement('label');
    item.className = 'model-card' + (isSelected ? ' model-card--selected' : '');
    item.innerHTML = `
      <input type="radio" name="model" value="${escHtml(model.id)}"${isSelected ? ' checked' : ''}>
      <div class="model-card__info">
        <span class="model-card__name">${escHtml(model.label)}</span>
        <span class="model-card__desc">${escHtml(model.description)}</span>
      </div>
      <div class="model-card__meta">
        <span class="model-card__size">${model.sizeMB} MB</span>
        <span class="badge ${badgeClass}">${badgeText}</span>
      </div>
    `;
    dom.modelList.appendChild(item);
  }
}

function renderStatus() {
  const { modelStatus, transcriptionStatus, downloadOverall, transcriptionProgress } = state;

  let statusLabel = '';
  let showProgress = false;
  let progressValue = 0;

  if (modelStatus === 'loading') {
    const pct = Math.round(downloadOverall * 100);
    statusLabel = downloadOverall > 0
      ? `Downloading model… ${pct}%`
      : 'Loading model…';
    showProgress = downloadOverall > 0;
    progressValue = downloadOverall;
  } else if (modelStatus === 'ready') {
    if (transcriptionStatus === 'idle') {
      if (state.activeDevice === 'webgpu') {
        statusLabel = 'Ready — GPU';
      } else if (state.activeDevice === 'wasm') {
        const cores = navigator.hardwareConcurrency;
        statusLabel = cores ? `Ready — CPU (${cores} cores)` : 'Ready — CPU';
      } else {
        statusLabel = 'Ready';
      }
    } else if (transcriptionStatus === 'decoding') {
      statusLabel = 'Decoding audio…';
    } else if (transcriptionStatus === 'transcribing') {
      const pct = Math.round(transcriptionProgress * 100);
      statusLabel = transcriptionProgress > 0
        ? `Transcribing… ${pct}%`
        : 'Transcribing…';
      showProgress = transcriptionProgress > 0;
      progressValue = transcriptionProgress;
    } else if (transcriptionStatus === 'done') {
      statusLabel = 'Done';
    } else if (transcriptionStatus === 'error') {
      statusLabel = 'Transcription failed';
    }
  } else if (modelStatus === 'error') {
    statusLabel = 'Model failed to load';
  } else {
    statusLabel = 'Initialising…';
  }

  dom.statusText.textContent = statusLabel;
  dom.progressBar.hidden = !showProgress;
  if (showProgress) {
    dom.progressBar.value = progressValue;
    dom.progressBar.setAttribute('aria-valuenow', Math.round(progressValue * 100));
  }
}

function restoreOptions(settings) {
  // Only restore if values actually differ — avoids disrupting user mid-interaction
  syncSelect(dom.languageSelect, settings.language);
  syncRadio(dom.optionsForm, 'task', settings.task);
  syncCheckbox(dom.timestampsCheck, settings.timestamps);
  syncCheckbox(dom.cleanupCheck, settings.cleanupWhitespace);
  syncCheckbox(dom.autoCopyCheck, settings.autoCopy);
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function canTranscribe() {
  return (
    !!state.selectedFile &&
    !state.fileError &&
    state.modelStatus === 'ready' &&
    state.transcriptionStatus !== 'decoding' &&
    state.transcriptionStatus !== 'transcribing'
  );
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function resolveDom() {
  dom = {
    fileInput:         document.getElementById('file-input'),
    fileInfo:          document.getElementById('file-info'),
    fileError:         document.getElementById('file-error'),
    fileWarning:       document.getElementById('file-warning'),
    modelList:         document.getElementById('model-list'),
    modelError:        document.getElementById('model-error'),
    modelWarning:      document.getElementById('model-warning'),
    optionsForm:       document.getElementById('options-form'),
    languageSelect:    document.getElementById('opt-language'),
    taskTranscribe:    document.getElementById('opt-task-transcribe'),
    taskTranslate:     document.getElementById('opt-task-translate'),
    timestampsCheck:   document.getElementById('opt-timestamps'),
    cleanupCheck:      document.getElementById('opt-cleanup'),
    autoCopyCheck:     document.getElementById('opt-autocopy'),
    transcribeBtn:     document.getElementById('transcribe-btn'),
    statusText:        document.getElementById('status-text'),
    progressBar:       document.getElementById('progress-bar'),
    transcriptArea:    document.getElementById('transcript'),
    transcriptionError:document.getElementById('transcription-error'),
    copyBtn:           document.getElementById('copy-btn'),
  };
}

function showError(el, message) {
  el.textContent = message;
  el.hidden = false;
}

function hideError(el) {
  el.textContent = '';
  el.hidden = true;
}

function formatFileInfo(file) {
  const sizeMB = (file.size / 1_048_576).toFixed(2);
  return `${file.name} (${sizeMB} MB)`;
}

function syncSelect(el, value) {
  if (el.value !== value) el.value = value;
}

function syncRadio(form, name, value) {
  const radio = form.querySelector(`input[name="${name}"][value="${value}"]`);
  if (radio && !radio.checked) radio.checked = true;
}

function syncCheckbox(el, checked) {
  if (el.checked !== checked) el.checked = checked;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
