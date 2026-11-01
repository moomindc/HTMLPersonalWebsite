const MAX_FILE_SIZE = 5_000_000; // 5 MB

export function initTranscript() {
  const zone      = document.getElementById('upload-zone');
  const fileInput = document.getElementById('transcript-file');
  const textarea  = document.getElementById('transcript');
  const fileInfo  = document.getElementById('file-info');

  zone.addEventListener('click', (e) => {
    if (e.target !== fileInput) fileInput.click();
  });
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('upload-zone--drag');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('upload-zone--drag'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('upload-zone--drag');
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file, textarea, fileInfo);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) loadFile(fileInput.files[0], textarea, fileInfo);
  });
}

function loadFile(file, textarea, fileInfo) {
  if (file.size > MAX_FILE_SIZE) {
    fileInfo.textContent = '⚠ File too large (max 5 MB). Please paste the text instead.';
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    textarea.value = text;
    fileInfo.textContent = `${file.name} — ${text.length.toLocaleString()} characters`;
    textarea.dispatchEvent(new Event('input'));
  };
  reader.onerror = () => {
    fileInfo.textContent = '⚠ Could not read file.';
  };
  reader.readAsText(file);
}

export function getTranscriptText() {
  return document.getElementById('transcript')?.value ?? '';
}

export function chunkText(text, chunkSize = 2000, overlap = 200) {
  const chunks = [];
  const step   = Math.max(1, chunkSize - overlap);
  for (let start = 0; start < text.length; start += step) {
    chunks.push(text.slice(start, start + chunkSize));
  }
  return chunks;
}

export function getRelevantChunks(chunks, query, n = 5) {
  const words = query.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  if (!words.length) return chunks.slice(0, n);

  const scored = chunks.map((chunk, i) => {
    const lower = chunk.toLowerCase();
    const score = words.reduce((sum, w) => sum + (lower.split(w).length - 1), 0);
    return { chunk, score, i };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, n).sort((a, b) => a.i - b.i).map(s => s.chunk);
}
