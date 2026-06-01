/**
 * lib/ingest/chunker.mjs — paragraph-boundary chunker with sentence overlap.
 *
 * 2026-06 best practice notes:
 *   - Recursive/sentence chunking remains the high-recall default (~85-90%
 *     on 2026 RAG benchmarks). Semantic chunking gains only ~2-3% recall at
 *     ~14× the embedding cost and only matters above ~5k token docs.
 *   - Parent-document retrieval is the meaningful 2026 upgrade beyond
 *     paragraph chunking — track separately if recall plateaus.
 *
 * Strategy:
 *   1. Split markdown by blank-line paragraph boundaries.
 *   2. Pack paragraphs into chunks under maxChars (default 1500 ≈ 375 tokens).
 *   3. Add 1-2 sentence overlap between consecutive chunks to preserve
 *      cross-chunk anchors.
 *   4. Preserve markdown structure: never split inside a fenced code block.
 */

const DEFAULT_MAX_CHARS = 1500;
const DEFAULT_OVERLAP_SENTENCES = 2;
const SENTENCE_RE = /[^.!?]+[.!?]+["')\]]*\s*/g;

export function splitSentences(text) {
  const matches = text.match(SENTENCE_RE);
  if (matches && matches.length) return matches.map((s) => s.trim()).filter(Boolean);
  return text.split('\n').map((s) => s.trim()).filter(Boolean);
}

function tailSentences(text, count) {
  const sentences = splitSentences(text);
  return sentences.slice(-count).join(' ');
}

function splitParagraphs(markdown) {
  const blocks = [];
  let buffer = '';
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (/^```/.test(line.trim())) inFence = !inFence;
    if (!inFence && line.trim() === '' && buffer.trim()) {
      blocks.push(buffer.trim());
      buffer = '';
      continue;
    }
    buffer += line + '\n';
  }
  if (buffer.trim()) blocks.push(buffer.trim());
  return blocks;
}

export function chunkMarkdown(markdown, { maxChars = DEFAULT_MAX_CHARS, overlapSentences = DEFAULT_OVERLAP_SENTENCES } = {}) {
  const paragraphs = splitParagraphs(markdown || '');
  if (paragraphs.length === 0) return [];

  const chunks = [];
  let current = '';
  let chunkIndex = 0;
  const flushChunk = () => {
    if (!current.trim()) return;
    const text = current.trim();
    chunks.push({
      index: chunkIndex++,
      text,
      chars: text.length,
    });
    const overlap = overlapSentences > 0 ? tailSentences(text, overlapSentences) : '';
    current = overlap ? overlap + '\n\n' : '';
  };

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxChars && current.trim()) {
      flushChunk();
    }
    if (para.length > maxChars) {
      flushChunk();
      const sentences = splitSentences(para);
      let buf = '';
      for (const s of sentences) {
        if (buf.length + s.length + 1 > maxChars && buf.trim()) {
          chunks.push({ index: chunkIndex++, text: buf.trim(), chars: buf.trim().length });
          buf = (overlapSentences > 0 ? tailSentences(buf, overlapSentences) : '') + (overlapSentences > 0 ? ' ' : '');
        }
        buf += s + ' ';
      }
      if (buf.trim()) {
        current = buf.trim() + '\n\n';
      }
      continue;
    }
    current += (current ? '\n\n' : '') + para;
  }
  flushChunk();
  return chunks;
}
