const MAX_FULL_TEXT = 8000;

const transcriptWorker = new Worker('./js/transcript-worker.js');
const pendingChunks    = new Map();
let   workerMsgId      = 0;
transcriptWorker.onmessage = ({ data: { id, relevant } }) => {
  const resolve = pendingChunks.get(id);
  if (resolve) { pendingChunks.delete(id); resolve(relevant); }
};
transcriptWorker.onerror = (e) => {
  console.error('[TranscriptWorker] error:', e.message);
};

export function initChat(adapter, getTranscriptText, getSettings) {
  const messagesEl = document.getElementById('chat-messages');
  const inputEl    = document.getElementById('chat-input');
  const sendBtn    = document.getElementById('send-btn');
  const errorEl    = document.getElementById('chat-error');

  function setError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden      = !msg;
  }

  function appendBubble(role, text) {
    const div = document.createElement('div');
    div.className   = `chat-msg chat-msg--${role}`;
    div.textContent = text;

    if (role === 'assistant') {
      const wrapper = document.createElement('div');
      wrapper.className = 'chat-msg-wrapper';

      const copyBtn = document.createElement('button');
      copyBtn.className   = 'copy-msg-btn';
      copyBtn.title       = 'Copy to clipboard';
      copyBtn.type        = 'button';
      copyBtn.setAttribute('aria-label', 'Copy answer to clipboard');
      copyBtn.innerHTML   = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(div.textContent).then(() => {
          copyBtn.classList.add('copy-msg-btn--copied');
          setTimeout(() => copyBtn.classList.remove('copy-msg-btn--copied'), 1500);
        }).catch(() => {});
      });

      wrapper.appendChild(div);
      wrapper.appendChild(copyBtn);
      messagesEl.appendChild(wrapper);
    } else {
      messagesEl.appendChild(div);
    }

    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  async function send() {
    const query = inputEl.value.trim();
    if (!query) return;

    const transcript = getTranscriptText().trim();
    if (!transcript) { setError('Please upload or paste a transcript first.'); return; }
    if (!adapter.loaded) { setError('Please load a model first.'); return; }

    setError('');
    inputEl.value = '';
    inputEl.style.height = 'auto';
    sendBtn.disabled = true;

    appendBubble('user', query);
    const bubble = appendBubble('assistant', '…');
    bubble.classList.add('chat-msg--thinking');

    const settings  = getSettings();
    const context   = await buildContext(transcript, query, settings);
    const systemPrompt = settings.systemPrompt ? `${settings.systemPrompt}\n\n` : '';
    const messages  = [
      {
        role: 'system',
        content: `You are a helpful assistant. Answer questions based only on the following transcript. If the answer is not in the transcript, say so.\n\n${systemPrompt}Transcript:\n${context}`,
      },
      { role: 'user', content: query },
    ];

    let firstToken = true;
    try {
      await adapter.chat(messages, {
        temperature: settings.temperature,
        maxTokens:   settings.maxTokens,
        onToken: (token) => {
          if (firstToken) {
            bubble.textContent = '';
            bubble.classList.remove('chat-msg--thinking');
            firstToken = false;
          }
          bubble.textContent += token;
          messagesEl.scrollTop = messagesEl.scrollHeight;
        },
      });
      if (firstToken) {
        bubble.textContent = '(no response)';
        bubble.classList.remove('chat-msg--thinking');
      }
    } catch (err) {
      bubble.textContent = `Error: ${err.message}`;
      bubble.classList.remove('chat-msg--thinking');
      bubble.classList.add('chat-msg--error');
      console.error('Inference error:', err);
    } finally {
      sendBtn.disabled = false;
      inputEl.focus();
    }
  }

  sendBtn.addEventListener('click', send);

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
  });

  document.addEventListener('model:loaded', () => { sendBtn.disabled = false; });
}

function buildContext(text, query, settings) {
  if (text.length <= MAX_FULL_TEXT) return Promise.resolve(text);
  return new Promise((resolve) => {
    const id = ++workerMsgId;
    pendingChunks.set(id, (relevant) => resolve(relevant.join('\n\n---\n\n')));
    transcriptWorker.postMessage({ id, text, query, chunkSize: settings.chunkSize, overlap: settings.overlap });
  });
}
