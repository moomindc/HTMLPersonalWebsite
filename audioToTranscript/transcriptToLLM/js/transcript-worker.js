function chunkText(text, chunkSize, overlap) {
  const chunks = [];
  const step   = Math.max(1, chunkSize - overlap);
  for (let start = 0; start < text.length; start += step)
    chunks.push(text.slice(start, start + chunkSize));
  return chunks;
}

function getRelevantChunks(chunks, query, n = 5) {
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

self.onmessage = ({ data: { id, text, query, chunkSize, overlap } }) => {
  const chunks   = chunkText(text, chunkSize, overlap);
  const relevant = getRelevantChunks(chunks, query);
  self.postMessage({ id, relevant });
};
