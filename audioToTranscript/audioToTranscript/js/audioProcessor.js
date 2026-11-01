/**
 * audioProcessor.js
 * Validates uploaded audio files and decodes them to a 16 kHz mono Float32Array
 * suitable for Whisper inference via Transformers.js.
 */

/** Audio formats accepted by the application. */
const ALLOWED_TYPES = new Set([
  'audio/mpeg',       // MP3
  'audio/mp3',        // MP3 (alternate MIME)
  'audio/wav',        // WAV
  'audio/x-wav',      // WAV (alternate)
  'audio/wave',       // WAV (alternate)
  'audio/mp4',        // M4A
  'audio/x-m4a',      // M4A (alternate)
  'audio/m4a',        // M4A (alternate)
  'audio/ogg',        // OGG
  'audio/flac',       // FLAC
  'audio/x-flac',     // FLAC (alternate)
  'audio/webm',       // WebM audio
]);

/** Extension fallback when MIME type is unreliable (e.g. some OS/browser combos). */
const ALLOWED_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.webm']);

/** Target sample rate required by Whisper. */
const TARGET_SAMPLE_RATE = 16000;

/**
 * Validate that a File is a supported audio format.
 * Throws a user-friendly Error if invalid.
 * @param {File} file
 */
export function validateFile(file) {
  if (!file) throw new Error('No file selected.');

  const mime = (file.type || '').toLowerCase();
  const ext = getExtension(file.name);

  if (!ALLOWED_TYPES.has(mime) && !ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(
      `Unsupported file format: "${file.name}". ` +
      `Supported formats: MP3, WAV, M4A, OGG, FLAC, WebM.`
    );
  }
}

/**
 * Decode an audio File to a 16 kHz mono Float32Array.
 * Uses the Web Audio API — supported in all modern browsers.
 *
 * @param {File} file
 * @param {function(number):void} [onProgress] - Called with 0..1 as decode progresses (best-effort)
 * @returns {Promise<Float32Array>}
 */
export async function decodeAudio(file, onProgress) {
  // 1. Read file as ArrayBuffer
  const arrayBuffer = await readFileAsArrayBuffer(file);

  onProgress?.(0.2);

  // 2. Decode compressed audio to PCM using the browser's built-in codec support
  const audioCtx = new AudioContext();
  let audioBuffer;
  try {
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } catch (err) {
    throw new Error(
      `Failed to decode audio file. The file may be corrupted or use an unsupported codec. (${err.message})`
    );
  } finally {
    audioCtx.close();
  }

  onProgress?.(0.6);

  // 3. Mix down to mono (average all channels)
  const mono = mixToMono(audioBuffer);

  onProgress?.(0.7);

  // 4. Resample to TARGET_SAMPLE_RATE (16 kHz) if necessary
  const resampled =
    audioBuffer.sampleRate === TARGET_SAMPLE_RATE
      ? mono
      : await resample(mono, audioBuffer.sampleRate, TARGET_SAMPLE_RATE);

  onProgress?.(1.0);

  return resampled;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Average all channels of an AudioBuffer into a single mono Float32Array.
 * @param {AudioBuffer} buf
 * @returns {Float32Array}
 */
function mixToMono(buf) {
  const numChannels = buf.numberOfChannels;
  const length = buf.length;

  if (numChannels === 1) {
    return buf.getChannelData(0).slice();
  }

  const output = new Float32Array(length);
  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = buf.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      output[i] += channelData[i];
    }
  }
  for (let i = 0; i < length; i++) {
    output[i] /= numChannels;
  }
  return output;
}

/**
 * Resample a Float32Array from sourceSR to targetSR using OfflineAudioContext.
 * @param {Float32Array} samples
 * @param {number} sourceSR
 * @param {number} targetSR
 * @returns {Promise<Float32Array>}
 */
async function resample(samples, sourceSR, targetSR) {
  const targetLength = Math.round((samples.length * targetSR) / sourceSR);
  const offlineCtx = new OfflineAudioContext(1, targetLength, targetSR);

  // Create a source buffer at the original sample rate
  const srcBuffer = offlineCtx.createBuffer(1, samples.length, sourceSR);
  srcBuffer.copyToChannel(samples, 0);

  const source = offlineCtx.createBufferSource();
  source.buffer = srcBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);

  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0).slice();
}

function getExtension(filename) {
  const idx = filename.lastIndexOf('.');
  return idx >= 0 ? filename.slice(idx).toLowerCase() : '';
}
