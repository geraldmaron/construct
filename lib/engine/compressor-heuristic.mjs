/**
 * lib/engine/compressor-heuristic.mjs — TF-IDF Compressor plugin (zero deps).
 *
 * Scores every sentence in the input by the mean IDF of its content terms
 * (over the input itself), keeps the top-N sentences in their original order
 * until the requested compression ratio is met, and returns the result. This
 * is a lossy summarizer — fine for context blocks where the model needs the
 * gist, not exact wording.
 *
 * The wider plan calls for a learned compressor (LLMLingua-2 token
 * classification on ONNX) as a plugin override. That belongs in its own
 * module so operators can opt into the model download. The default keeps
 * the contract live, runs on every machine, and gives a measurable win
 * for context-block compression where exact phrasing is not load-bearing.
 *
 * Plugin contract (Compressor):
 *   meta: { id, ratio }
 *   compress(text, opts) → text
 *
 * `ratio` is the target output / input length (0.5 = halve the text).
 * `maxTokens` (estimated from text length) acts as a hard ceiling that
 * overrides ratio when present.
 */

import { tokenize, buildTermFrequencies, buildIdf } from '../storage/embeddings.mjs';

const SENTENCE_BOUNDARY = /(?<=[.!?])\s+(?=[A-Z(\[])|\n{2,}/;

function splitSentences(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];
  return trimmed.split(SENTENCE_BOUNDARY).map((s) => s.trim()).filter(Boolean);
}

function scoreSentence(sentence, idf) {
  const terms = tokenize(sentence);
  if (terms.length === 0) return 0;
  let total = 0;
  let counted = 0;
  for (const term of terms) {
    const v = idf.get(term);
    if (v !== undefined) {
      total += v;
      counted += 1;
    }
  }
  return counted === 0 ? 0 : total / counted;
}

const APPROX_CHARS_PER_TOKEN = 4;

export function create({ ratio = 0.5 } = {}) {
  return {
    meta: { id: 'heuristic-tfidf-sentence', ratio },
    async compress(text, opts = {}) {
      const ratioEff = Math.max(0.05, Math.min(1, opts.ratio ?? ratio));
      const input = String(text || '');
      if (!input.trim()) return '';

      const sentences = splitSentences(input);
      if (sentences.length <= 1) return input;

      const tfMaps = sentences.map((s) => buildTermFrequencies(s));
      const idf = buildIdf(tfMaps);

      const scored = sentences.map((sentence, index) => ({
        index,
        sentence,
        score: scoreSentence(sentence, idf),
        len: sentence.length,
      }));

      let targetChars = Math.floor(input.length * ratioEff);
      if (typeof opts.maxTokens === 'number' && opts.maxTokens > 0) {
        const ceiling = opts.maxTokens * APPROX_CHARS_PER_TOKEN;
        if (ceiling < targetChars) targetChars = ceiling;
      }

      const ordered = [...scored].sort((a, b) => b.score - a.score || a.index - b.index);
      const kept = new Set();
      let used = 0;
      for (const candidate of ordered) {
        if (used + candidate.len > targetChars && kept.size > 0) continue;
        kept.add(candidate.index);
        used += candidate.len + 1;
        if (used >= targetChars) break;
      }

      if (kept.size === 0) kept.add(ordered[0].index);

      return scored
        .filter((s) => kept.has(s.index))
        .sort((a, b) => a.index - b.index)
        .map((s) => s.sentence)
        .join(' ');
    },
  };
}

export default create;
