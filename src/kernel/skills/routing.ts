/**
 * kernel/skills/routing.ts — which skills a request in ordinary language
 * most plausibly asks for, ranked, so the host model reading the list can
 * choose without the person naming a skill.
 *
 * The final judge is the model in the session: measured on natural requests
 * that borrow no skill vocabulary, a host-class model reading the catalog
 * picks the right skill almost every time, while every lexical method tops
 * out near half. So this module does not decide; it orders. It retrieves
 * over each skill's description, its activation phrases, and the requests
 * its eval file labels as activating (BM25 over stems, plus nearest labeled
 * examples), and returns every skill with a band: likely, possible, or
 * unlikely. A host reads the likely ones first and may still pick another.
 * Stand-down phrases demote a skill they match better than its activation
 * phrases do.
 */

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'be', 'it', 'this', 'that', 'with', 'about', 'when', 'someone', 'something', 'not', 'no', 'one', 'at', 'by', 'as', 'from', 'into', 'you', 'your', 'we', 'our', 'my', 'i', 'me', 'do', 'does', 'will', 'would', 'should', 'has', 'have', 'its', 'their', 'them', 'they', 'over', 'up', 'out', 'so', 'if', 'than', 'then', 'just', 'any', 'some', 'all', 'more', 'most', 'very', 'can', 'could', 'use', 'person', 'says', 'like', 'thing', 'things']);

function stem(word: string): string {
  let w = word.replace(/(ies|ied)$/, 'y').replace(/(ing|ed|es|s)$/, '').replace(/ly$/, '');
  if (/([a-z])\1$/.test(w)) w = w.slice(0, -1);
  return w;
}

/** Stems of the content words in a text, in order, repeats kept. */
export function stems(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map(stem);
}

export interface RoutableSkill {
  readonly id: string;
  readonly description: string;
  readonly activation: readonly string[];
  readonly standDown: readonly string[];
  /** Requests labeled as activating this skill, from its eval file. */
  readonly examples: readonly string[];
}

export type RoutingBand = 'likely' | 'possible' | 'unlikely';

export interface RoutedSkill {
  readonly id: string;
  readonly score: number;
  readonly band: RoutingBand;
  /** The labeled example that came closest, when one did; a reader checks it against the request. */
  readonly nearestExample: string | null;
}

interface Doc {
  readonly id: string;
  readonly tf: Map<string, number>;
  readonly len: number;
}

interface Index {
  readonly docs: readonly Doc[];
  readonly idf: Map<string, number>;
  readonly avg: number;
}

function buildIndex(entries: readonly { id: string; texts: readonly string[] }[]): Index {
  const docs = entries.map((e) => {
    const tf = new Map<string, number>();
    let len = 0;
    for (const t of e.texts) for (const w of stems(t)) { tf.set(w, (tf.get(w) ?? 0) + 1); len += 1; }
    return { id: e.id, tf, len };
  });
  const df = new Map<string, number>();
  for (const d of docs) for (const w of d.tf.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = new Map<string, number>();
  for (const [w, n] of df) idf.set(w, Math.log(1 + (docs.length - n + 0.5) / (n + 0.5)));
  const avg = docs.length ? docs.reduce((a, d) => a + d.len, 0) / docs.length : 1;
  return { docs, idf, avg: avg || 1 };
}

function bm25(query: readonly string[], index: Index): Map<string, number> {
  const k1 = 1.2;
  const b = 0.75;
  const out = new Map<string, number>();
  for (const d of index.docs) {
    let s = 0;
    for (const w of query) {
      const f = d.tf.get(w) ?? 0;
      if (f === 0) continue;
      s += (index.idf.get(w) ?? 0) * (f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / index.avg));
    }
    out.set(d.id, s);
  }
  return out;
}

function nearest(query: readonly string[], skills: readonly RoutableSkill[], k: number): { readonly perSkill: Map<string, number>; readonly example: Map<string, string> } {
  const q = new Set(query);
  const sims: { id: string; text: string; sim: number }[] = [];
  for (const s of skills) {
    for (const text of s.examples) {
      const es = stems(text);
      const inter = es.filter((w) => q.has(w)).length;
      if (inter === 0) continue;
      sims.push({ id: s.id, text, sim: inter / Math.sqrt(Math.max(1, es.length) * Math.max(1, q.size)) });
    }
  }
  sims.sort((a, b) => b.sim - a.sim);
  const perSkill = new Map<string, number>();
  const example = new Map<string, string>();
  for (const s of sims.slice(0, k)) {
    perSkill.set(s.id, (perSkill.get(s.id) ?? 0) + s.sim);
    if (!example.has(s.id)) example.set(s.id, s.text);
  }
  return { perSkill, example };
}

/**
 * How much the single nearest labeled example adds on top of retrieval.
 * Measured 2026-09-02 over the routing set and leave-one-out examples: 0.3
 * with one neighbour holds both; weighting examples at parity memorizes
 * them and drops leave-one-out top-1 from 62/84 to 15/84.
 */
const EXAMPLE_WEIGHT = 0.3;

export interface Router {
  route(request: string): RoutedSkill[];
}

/** Build a router once per catalog; routing a request is then a few map lookups. */
export function createRouter(skills: readonly RoutableSkill[]): Router {
  const positive = buildIndex(skills.map((s) => ({ id: s.id, texts: [s.description, ...s.activation, ...s.examples] })));
  const negative = buildIndex(skills.map((s) => ({ id: s.id, texts: s.standDown })));
  return {
    route(request) {
      const q = stems(request);
      if (q.length === 0) return skills.map((s) => ({ id: s.id, score: 0, band: 'unlikely' as const, nearestExample: null }));
      const pos = bm25(q, positive);
      const neg = bm25(q, negative);
      const near = nearest(q, skills, 1);
      const posMax = Math.max(...pos.values(), 0) || 1;
      const nearMax = Math.max(...near.perSkill.values(), 0) || 1;
      const scored = skills.map((s) => {
        const retrieval = (pos.get(s.id) ?? 0) / posMax;
        const example = (near.perSkill.get(s.id) ?? 0) / nearMax;
        const demotion = (neg.get(s.id) ?? 0) > (pos.get(s.id) ?? 0) ? 0.5 : 1;
        return { id: s.id, score: Number(((retrieval + EXAMPLE_WEIGHT * example) * demotion).toFixed(4)), nearestExample: near.example.get(s.id) ?? null };
      });
      scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      const top = scored[0]?.score ?? 0;
      return scored.map((s, i) => ({
        ...s,
        band: top === 0 ? 'unlikely' : i < 5 && s.score >= top * 0.5 ? 'likely' : s.score >= top * 0.25 ? 'possible' : 'unlikely',
      }));
    },
  };
}

export interface EvalCase {
  readonly text: string;
  readonly expect: 'activate' | 'stand_down';
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
    for (const key of Object.keys(cc)) if (!['text', 'expect', 'why'].includes(key)) throw new Error(`${path}: cases[${String(i)}] has an unknown field "${key}"`);
    return { text: cc.text, expect: cc.expect, why: typeof cc.why === 'string' ? cc.why : undefined } as EvalCase;
  });
  const kinds = new Set(cases.map((c) => c.expect));
  if (!kinds.has('activate') || !kinds.has('stand_down')) throw new Error(`${path}: evals need at least one activate and one stand_down case`);
  return { format: 'construct-skill-evals', formatVersion: 1, cases };
}

/** The activating requests an eval file carries, or none when the bytes are absent or malformed; the lint reports the latter. */
export function examplesFrom(bytes: Uint8Array | null): string[] {
  if (!bytes) return [];
  try {
    const file = validateEvalFile(JSON.parse(new TextDecoder().decode(bytes)) as unknown, 'evals/activation.json');
    return file.cases.filter((c) => c.expect === 'activate').map((c) => c.text);
  } catch {
    return [];
  }
}

export interface RoutingCase {
  readonly text: string;
  /** The skill the request asks for, or "none" when no skill should load. */
  readonly skill: string;
}

export interface RoutingEvalFile {
  readonly format: 'construct-routing-evals';
  readonly formatVersion: 1;
  readonly labeledBy: string;
  readonly cases: readonly RoutingCase[];
}

export function validateRoutingEvalFile(raw: unknown, path: string): RoutingEvalFile {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${path}: must be an object`);
  const r = raw as Record<string, unknown>;
  if (r.format !== 'construct-routing-evals' || r.formatVersion !== 1) throw new Error(`${path}: must carry format construct-routing-evals 1`);
  if (typeof r.labeledBy !== 'string' || r.labeledBy.trim() === '') throw new Error(`${path}: labeledBy must name who labeled the cases and when`);
  if (!Array.isArray(r.cases) || r.cases.length === 0) throw new Error(`${path}: "cases" must be a non-empty list`);
  const cases = r.cases.map((c, i) => {
    const cc = c as Record<string, unknown>;
    if (typeof cc?.text !== 'string' || cc.text.trim() === '' || typeof cc.skill !== 'string' || cc.skill.trim() === '') throw new Error(`${path}: cases[${String(i)}] needs text and skill`);
    return { text: cc.text, skill: cc.skill };
  });
  return { format: 'construct-routing-evals', formatVersion: 1, labeledBy: r.labeledBy, cases };
}

export interface RoutingMeasure {
  readonly cases: number;
  readonly top1: number;
  readonly top3: number;
  readonly top5: number;
  readonly noneCases: number;
  readonly falseLoads: number;
  readonly misses: readonly { readonly text: string; readonly skill: string; readonly got: readonly string[] }[];
}

/** Top-k hit rates of a router over a labeled set; a "none" case counts as a false load when the top skill is banded likely. */
export function measureRouting(router: Router, cases: readonly RoutingCase[]): RoutingMeasure {
  let top1 = 0;
  let top3 = 0;
  let top5 = 0;
  let noneCases = 0;
  let falseLoads = 0;
  const misses: { text: string; skill: string; got: string[] }[] = [];
  for (const c of cases) {
    const ranked = router.route(c.text);
    if (c.skill === 'none') {
      noneCases += 1;
      if (ranked[0]?.band === 'likely' && ranked[0].score >= 1) falseLoads += 1;
      continue;
    }
    const ids = ranked.map((r) => r.id);
    if (ids[0] === c.skill) top1 += 1;
    else misses.push({ text: c.text, skill: c.skill, got: ids.slice(0, 3) });
    if (ids.slice(0, 3).includes(c.skill)) top3 += 1;
    if (ids.slice(0, 5).includes(c.skill)) top5 += 1;
  }
  return { cases: cases.length - noneCases, top1, top3, top5, noneCases, falseLoads, misses };
}
