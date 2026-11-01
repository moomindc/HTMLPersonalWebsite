/**
 * settings.js
 * Manages user preferences via a single JSON cookie (atSettings).
 * Cookies store only lightweight preferences — never model binaries or transcripts.
 */

const COOKIE_NAME = 'atSettings';
const COOKIE_DAYS = 365;

/** Default preference values applied when no cookie exists or a key is missing. */
const DEFAULTS = {
  selectedModel: 'Xenova/whisper-base.en',
  language: 'auto',
  task: 'transcribe',        // 'transcribe' | 'translate'
  timestamps: false,
  cleanupWhitespace: true,
  autoCopy: false,
};

/**
 * Load settings from the atSettings cookie, merged with defaults.
 * Silently falls back to defaults if the cookie is absent or malformed.
 * @returns {object}
 */
export function loadSettings() {
  try {
    const raw = getCookieValue(COOKIE_NAME);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(decodeURIComponent(raw));
    // Merge with defaults so new keys always have a value
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Persist settings to the atSettings cookie.
 * Silently swallows any write errors (e.g. private-browsing restrictions).
 * @param {object} settings
 */
export function saveSettings(settings) {
  try {
    // Only persist known keys to avoid cookie bloat
    const toStore = {
      selectedModel: settings.selectedModel,
      language: settings.language,
      task: settings.task,
      timestamps: settings.timestamps,
      cleanupWhitespace: settings.cleanupWhitespace,
      autoCopy: settings.autoCopy,
    };
    const encoded = encodeURIComponent(JSON.stringify(toStore));
    const expires = cookieExpiryString(COOKIE_DAYS);
    document.cookie = `${COOKIE_NAME}=${encoded}; expires=${expires}; path=/; SameSite=Lax`;
  } catch {
    // Non-fatal — app continues with in-memory settings
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCookieValue(name) {
  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length);
    }
  }
  return null;
}

function cookieExpiryString(days) {
  const date = new Date();
  date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
  return date.toUTCString();
}
