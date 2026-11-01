/**
 * clipboardManager.js
 * Copies text to the clipboard using the modern Clipboard API where available,
 * with a textarea-based fallback for browsers that restrict clipboard access.
 */

/**
 * Copy text to the clipboard.
 * @param {string} text
 * @returns {Promise<{ success: boolean, method: 'api'|'fallback'|'failed' }>}
 */
export async function copyToClipboard(text) {
  // Prefer the modern async Clipboard API (requires secure context or user gesture)
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return { success: true, method: 'api' };
    } catch {
      // Fall through to the textarea approach
    }
  }

  // Fallback: create a temporary off-screen textarea, select its content, and copy
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    // Position off-screen so it doesn't flash on screen
    textarea.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return { success: ok, method: ok ? 'fallback' : 'failed' };
  } catch {
    return { success: false, method: 'failed' };
  }
}
