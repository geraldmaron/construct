/**
 * kernel/skills/activation.ts — a deterministic, lexical proxy for whether a
 * skill's activation or stand-down conditions match a request.
 *
 * It is a proxy, and says so: it scores word overlap between a request and
 * the phrases a manifest declares, and answers activate, stand down, or
 * undecided. It exists so every skill ships checkable trigger fixtures and
 * so a manifest whose phrases cannot tell its own positive cases from its
 * negative ones fails before it ships. The real judge in use is the host
 * model reading the same phrases; the conformance command measures that.
 */

import type { SkillManifest } from '../registry/models.ts';

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'be', 'it', 'this', 'that', 'with', 'about', 'when', 'someone', 'something', 'not', 'no', 'one', 'at', 'by', 'as', 'from', 'into', 'you', 'your', 'we', 'our', 'my', 'i', 'me', 'do', 'does', 'will', 'would', 'should', 'has', 'have', 'its', 'their', 'them', 'they', 'over', 'up', 'out', 'so', 'if', 'than', 'then', 'just', 'any', 'some', 'all', 'more', 'most', 'very', 'can', 'could']);

function stem(word: string): string {
  let w = word.replace(/(ies|ied)$/, 'y').replace(/(ing|ed|es|s)$/, '').replace(/ly$/, '');
  if (/([a-z])\1$/.test(w)) w = w.slice(0, -1);
  return w;
}

export function terms(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/[\s-]+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map(stem),
  );
}

/** Two stems match when equal, or when one is a prefix of the other and the shorter is at least four characters. */
function sameTerm(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.startsWith(short);
}

function hasTerm(request: Set<string>, term: string): boolean {
  for (const r of request) if (sameTerm(r, term)) return true;
  return false;
}

export interface ActivationScore {
  readonly verdict: 'activate' | 'stand_down' | 'undecided';
  readonly activation: number;
  readonly standDown: number;
  readonly matchedActivation: readonly string[];
  readonly matchedStandDown: readonly string[];
}

/** The best single phrase match: a phrase counts when two of its terms appear, or a third of a short one. */
function best(request: Set<string>, phrases: readonly string[]): { score: number; matched: string[] } {
  let score = 0;
  const matched: string[] = [];
  for (const phrase of phrases) {
    const ts = [...terms(phrase)];
    const hits = ts.filter((t) => hasTerm(request, t)).length;
    if (hits === 0) continue;
    const fraction = hits / Math.max(1, ts.length);
    const strength = fraction + hits * 0.05;
    if (hits >= 2 || fraction >= 0.34) {
      matched.push(phrase);
      if (strength > score) score = strength;
    }
  }
  return { score, matched };
}

/** Score one request against a manifest's activation and stand-down phrases. */
export function scoreActivation(manifest: Pick<SkillManifest, 'activation' | 'standDown'>, request: string): ActivationScore {
  const req = terms(request);
  const a = best(req, manifest.activation);
  const s = best(req, manifest.standDown);
  let verdict: ActivationScore['verdict'] = 'undecided';
  if (a.matched.length > 0 && a.score > s.score) verdict = 'activate';
  else if (s.matched.length > 0 && s.score >= a.score) verdict = 'stand_down';
  return { verdict, activation: a.score, standDown: s.score, matchedActivation: a.matched, matchedStandDown: s.matched };
}

export interface EvalCase {
  readonly text: string;
  readonly expect: 'activate' | 'stand_down';
  /** lexical: this proxy must agree. model: only a host model can judge; the conformance command runs it. */
  readonly judge: 'lexical' | 'model';
  readonly why?: string;
}

export interface EvalFile {
  readonly format: 'construct-skill-evals';
  readonly formatVersion: 1;
  readonly cases: readonly EvalCase[];
}

export function validateEvalFile(raw: unknown, path: string): EvalFile {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${path}: must be an object`);
  const r = raw as Record<string, unknown>;
  if (r.format !== 'construct-skill-evals' || r.formatVersion !== 1) throw new Error(`${path}: must carry format construct-skill-evals 1`);
  if (!Array.isArray(r.cases) || r.cases.length === 0) throw new Error(`${path}: "cases" must be a non-empty list`);
  const cases = r.cases.map((c, i) => {
    if (c === null || typeof c !== 'object' || Array.isArray(c)) throw new Error(`${path}: cases[${String(i)}] must be an object`);
    const cc = c as Record<string, unknown>;
    if (typeof cc.text !== 'string' || cc.text.trim() === '') throw new Error(`${path}: cases[${String(i)}].text must be a non-empty string`);
    if (cc.expect !== 'activate' && cc.expect !== 'stand_down') throw new Error(`${path}: cases[${String(i)}].expect must be activate or stand_down`);
    const judge = cc.judge ?? 'lexical';
    if (judge !== 'lexical' && judge !== 'model') throw new Error(`${path}: cases[${String(i)}].judge must be lexical or model`);
    return { text: cc.text, expect: cc.expect, judge, why: typeof cc.why === 'string' ? cc.why : undefined } as EvalCase;
  });
  const kinds = new Set(cases.map((c) => c.expect));
  if (!kinds.has('activate') || !kinds.has('stand_down')) throw new Error(`${path}: evals need at least one activate and one stand_down case`);
  return { format: 'construct-skill-evals', formatVersion: 1, cases };
}

export interface EvalResult {
  readonly text: string;
  readonly expect: EvalCase['expect'];
  readonly judge: EvalCase['judge'];
  readonly got: ActivationScore['verdict'] | 'skipped';
  readonly pass: boolean;
}

/** Run the lexical cases; model cases are reported as skipped, never as passed. */
export function runActivationEvals(manifest: Pick<SkillManifest, 'activation' | 'standDown'>, file: EvalFile): EvalResult[] {
  return file.cases.map((c) => {
    if (c.judge === 'model') return { text: c.text, expect: c.expect, judge: c.judge, got: 'skipped', pass: true };
    const got = scoreActivation(manifest, c.text).verdict;
    return { text: c.text, expect: c.expect, judge: c.judge, got, pass: got === c.expect };
  });
}
