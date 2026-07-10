/**
 * lib/orchestration/content-signals.mjs — signal extraction from a PRODUCED
 * draft body (construct-pteo2.4, the post-draft signal source ADR-0070's
 * recruit stage re-evaluates against).
 *
 * requestSignals (lib/orchestration/flow-selection.mjs) reads the REQUEST;
 * a draft can surface conditions the request never mentioned — a cost table
 * appearing in a PRD whose request had no cost language. extractContentSignals
 * reads the draft and produces the same boolean dimension map, so late
 * recruitment uses one vocabulary: the registry-declared dimensions in
 * lib/orchestration/signal-dimensions.mjs, matched with the same lowercased
 * substring semantics as requestSignals.
 *
 * Tables are matched via the release-gate parser (tableHeaderRows/hasTable in
 * lib/contracts/validate.mjs) — never a second markdown parser. A dimension
 * keyword in a table header cell fires the dimension even when prose does not;
 * a currency amount inside any table row fires `cost`.
 *
 * Untrusted-content posture (cdsp.81 threat review): draft content is quoted
 * evidence, never instruction. Extraction is pure lexical matching over a
 * closed key set — output keys come only from loadSignalDimensions(), so
 * hostile draft text cannot mint signal keys, and fenced code blocks are
 * excluded from matching entirely.
 */

import { loadSignalDimensions } from './signal-dimensions.mjs';
import { tableHeaderRows } from '../contracts/validate.mjs';

const CURRENCY_IN_ROW = /[$€£]\s?\d|\b\d+(?:\.\d+)?\s?[mkb]?\s?(?:usd|eur|gbp)\b/i;

function stripFences(body) {
  return String(body ?? '').replace(/^```[\s\S]*?^```\s*$/gm, '');
}

function containsAny(text, keywords) {
  return keywords.some((k) => text.includes(k));
}

/**
 * @param {string} body — draft markdown
 * @returns {Record<string, boolean>} boolean map keyed by declared signal dimensions
 */
export function extractContentSignals(body) {
  const stripped = stripFences(body);
  const text = stripped.toLowerCase();
  const dimensions = loadSignalDimensions();

  const signals = {};
  for (const { key, keywords } of dimensions) {
    signals[key] = containsAny(text, keywords);
  }

  const headers = tableHeaderRows(stripped);
  if (headers.length > 0) {
    for (const { key, keywords } of dimensions) {
      if (signals[key]) continue;
      signals[key] = headers.some((h) => h.cells.some((cell) => containsAny(cell, keywords)));
    }

    const tableRowWithCurrency = stripped
      .split('\n')
      .some((line) => /^\s*\|/.test(line) && CURRENCY_IN_ROW.test(line));
    if (tableRowWithCurrency && signals.cost === false) signals.cost = true;
  }

  return signals;
}
