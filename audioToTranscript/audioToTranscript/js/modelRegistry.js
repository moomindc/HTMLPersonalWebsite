/**
 * modelRegistry.js
 * Single source of truth for available transcription models.
 * Each entry describes a Whisper model variant available via Hugging Face Hub.
 */

export const MODEL_REGISTRY = [
  {
    id: 'Xenova/whisper-tiny.en',
    label: 'Tiny (English)',
    sizeMB: 39,
    description: 'Fastest, English only. Good for quick drafts.',
    multilingual: false,
    supportsTranslation: false,
    cached: false,
  },
  {
    id: 'Xenova/whisper-tiny',
    label: 'Tiny (Multilingual)',
    sizeMB: 39,
    description: 'Fastest, supports multiple languages and translation.',
    multilingual: true,
    supportsTranslation: true,
    cached: false,
  },
  {
    id: 'Xenova/whisper-base.en',
    label: 'Base (English)',
    sizeMB: 74,
    description: 'Balanced speed and accuracy, English only.',
    multilingual: false,
    supportsTranslation: false,
    cached: false,
  },
  {
    id: 'Xenova/whisper-base',
    label: 'Base (Multilingual)',
    sizeMB: 74,
    description: 'Balanced speed and accuracy, supports multiple languages.',
    multilingual: true,
    supportsTranslation: true,
    cached: false,
  },
  {
    id: 'Xenova/whisper-small.en',
    label: 'Small (English)',
    sizeMB: 244,
    description: 'Higher accuracy, English only. Slower download and inference.',
    multilingual: false,
    supportsTranslation: false,
    cached: false,
  },
  {
    id: 'Xenova/whisper-small',
    label: 'Small (Multilingual)',
    sizeMB: 244,
    description: 'Higher accuracy, supports multiple languages and translation.',
    multilingual: true,
    supportsTranslation: true,
    cached: false,
  },
  {
    id: 'onnx-community/distil-small.en',
    label: 'DistilWhisper Small (English)',
    sizeMB: 166,
    description: '6× faster than Whisper Small at similar accuracy. English only. Recommended for speed.',
    multilingual: false,
    supportsTranslation: false,
    cached: false,
  },
  {
    id: 'distil-whisper/distil-large-v3.5-ONNX',
    label: 'DistilWhisper Large v3.5 (English)',
    sizeMB: 756,
    description: 'Highest accuracy distil model. English only. Drop-in replacement for Whisper Large.',
    multilingual: false,
    supportsTranslation: false,
    cached: false,
  },
];

/** Default model ID used when no preference is stored. */
export const DEFAULT_MODEL_ID = 'Xenova/whisper-base.en';

/**
 * Look up a model entry by its ID.
 * @param {string} id
 * @returns {object|undefined}
 */
export function getModelById(id) {
  return MODEL_REGISTRY.find((m) => m.id === id);
}
