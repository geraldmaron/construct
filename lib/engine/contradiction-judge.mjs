/**
 * lib/engine/contradiction-judge.mjs — optional LLM second opinion for the
 * consolidation contradiction pass.
 *
 * The negation-polarity heuristic (lib/engine/contradiction.mjs) catches a
 * flipped claim but abstains on a value swap with no negation cue — "auth uses
 * RS256" vs "auth uses HS256" share every word yet disagree. Resolving that
 * needs to know the two values are mutually exclusive, which is semantic
 * judgment. This factory builds the judge consolidation consults only when the
 * heuristic says "no".
 *
 * Offline-first: the judge is backed by a local Ollama model and the factory
 * returns null when Ollama is not running or has no model, so consolidation
 * degrades to heuristic-only with no provider and no key required. The status
 * probe and the runner are injectable so the parse logic is testable without a
 * live model.
 */

import { checkOllamaStatus, testModel } from '../ollama-manager.mjs';

function buildPrompt(a, b) {
  const textA = (a?.summary || a?.content || '').slice(0, 400);
  const textB = (b?.summary || b?.content || '').slice(0, 400);
  return [
    'Two short notes describe the same subject. Decide whether they directly',
    'contradict — assert mutually exclusive facts (e.g. different algorithms,',
    'opposite states, incompatible values). A restatement or an added detail is',
    'NOT a contradiction. Answer with only YES or NO.',
    '',
    `Note A: ${textA}`,
    `Note B: ${textB}`,
    'Answer:',
  ].join('\n');
}

function parseVerdict(response) {
  const match = String(response || '').toLowerCase().match(/\b(yes|no)\b/);
  return { contradicts: !!match && match[1] === 'yes' };
}

/**
 * Build a contradiction judge, or null when no local model is available.
 *
 * @param {object} [opts]
 * @param {() => {running?: boolean, models?: Array<{name?: string, model?: string}>}} [opts.statusFn]
 * @param {(model: string, prompt: string) => {success?: boolean, response?: string}} [opts.runFn]
 * @param {string} [opts.model] explicit model override (else env, else first available)
 * @returns {{judge: (a: object, b: object) => {contradicts: boolean}} | null}
 */
export function createContradictionJudge({ statusFn = checkOllamaStatus, runFn = testModel, model } = {}) {
  const status = statusFn();
  if (!status?.running || !status.models?.length) return null;

  const chosen = model || process.env.CONSTRUCT_CONTRADICTION_JUDGE_MODEL ||
    status.models[0]?.name || status.models[0]?.model;
  if (!chosen) return null;

  return {
    judge(a, b) {
      try {
        const result = runFn(chosen, buildPrompt(a, b));
        if (!result?.success) return { contradicts: false };
        return parseVerdict(result.response);
      } catch {
        return { contradicts: false };
      }
    },
  };
}

export const __testing = { buildPrompt, parseVerdict };
