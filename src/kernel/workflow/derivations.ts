/** Arithmetic checks bind each operand to its own held evidence. They never establish entailment. */
import { realpathSync } from 'node:fs';
import type { RefResolver } from '../project/evidence.ts';
import { arithmeticTokens, citedFiguresIn, CONSTANTS, evaluateExpression, figureValue, normalizeFigure } from './arithmetic.ts';

export interface BoundOperand {
  readonly value: string;
  readonly ref?: string;
  readonly excerpt?: string;
  readonly derivationId?: string;
}
export interface BoundDerivation {
  readonly id: string;
  readonly claim: string;
  readonly value: string;
  readonly expression: string;
  readonly operands: readonly BoundOperand[];
  readonly decimalPlaces?: number;
}
export interface ArithmeticResult {
  readonly id: string;
  readonly claim: string;
  readonly value: string;
  readonly status: 'checked' | 'invalid';
  readonly semanticSupportVerified: false;
  readonly operands: readonly BoundOperand[];
  readonly problems: readonly string[];
}
export const DERIVATION_EXAMPLE = {
  id: 'net-a',
  claim: 'A net benefit is $8,000.',
  value: '8000',
  expression: '12000 - 4000',
  operands: [
    { value: '12000', ref: 'facts.md', excerpt: 'A benefit is $12,000.' },
    { value: '4000', ref: 'facts.md', excerpt: 'A cost is $4,000.' },
  ],
};
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const bounded = (v: unknown, cap: number): v is string => typeof v === 'string' && !!v.trim() && v.length <= cap;
const quote = (v: string) => v.replace(/\s+/g, ' ').trim();
export function numericEqual(a: number, b: number, operations = 1): boolean {
  return (
    Number.isFinite(a) &&
    Number.isFinite(b) &&
    Math.abs(a - b) <= Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)) * Math.max(1, operations) * 4
  );
}
/** Explicit decimal rounding: nearest, with ties away from zero, in base-unit magnitude. */
function rounded(value: number, places: number): number {
  const scale = 10 ** places;
  return (Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON * Math.abs(value)) * scale)) / scale;
}
export function parseDerivations(raw: unknown): BoundDerivation[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 50) throw new Error('derivations must be an array of at most 50 bound calculations');
  const ids = new Set<string>();
  return raw.map((d) => {
    if (
      !record(d) ||
      Object.keys(d).some((k) => !['id', 'claim', 'value', 'expression', 'operands', 'decimalPlaces'].includes(k)) ||
      !bounded(d.id, 80) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(d.id) ||
      ids.has(d.id) ||
      !bounded(d.claim, 4000) ||
      !bounded(d.value, 400) ||
      !bounded(d.expression, 4000) ||
      !Array.isArray(d.operands) ||
      d.operands.length > 100 ||
      (d.decimalPlaces !== undefined && (!Number.isInteger(d.decimalPlaces) || Number(d.decimalPlaces) < 0 || Number(d.decimalPlaces) > 12))
    )
      throw new Error(
        'each bound derivation needs a unique id, exact claim, string value, expression, operands and optional decimalPlaces (0–12); old unbound derivations are not accepted',
      );
    ids.add(d.id);
    const operands = d.operands.map((o) => {
      if (
        !record(o) ||
        Object.keys(o).some((k) => !['value', 'ref', 'excerpt', 'derivationId'].includes(k)) ||
        !bounded(o.value, 400) ||
        !(o.derivationId !== undefined
          ? bounded(o.derivationId, 80) && o.ref === undefined && o.excerpt === undefined
          : bounded(o.ref, 2000) && bounded(o.excerpt, 8000))
      )
        throw new Error('each operand needs a string value and either ref with exact excerpt, or derivationId');
      return o as unknown as BoundOperand;
    });
    return { ...d, operands } as unknown as BoundDerivation;
  });
}
export function verifyDerivations(input: {
  derivations: unknown;
  texts: readonly string[];
  evidence: readonly { ref: string }[];
  resolve?: RefResolver;
  excludedPaths?: ReadonlySet<string>;
}): { results: ArithmeticResult[]; problems: string[] } {
  let ds: BoundDerivation[];
  try {
    ds = parseDerivations(input.derivations);
  } catch (e) {
    return { results: [], problems: [(e as Error).message] };
  }
  const results = new Map<string, ArithmeticResult>();
  const visiting = new Set<string>();
  const byId = new Map(ds.map((d) => [d.id, d]));
  function check(d: BoundDerivation): ArithmeticResult {
    const held = results.get(d.id);
    if (held) return held;
    const problems: string[] = [];
    if (visiting.has(d.id))
      return {
        id: d.id,
        claim: d.claim,
        value: d.value,
        status: 'invalid',
        semanticSupportVerified: false,
        operands: d.operands,
        problems: ['cyclic derivation'],
      };
    visiting.add(d.id);
    if (!input.texts.some((t) => t.includes(d.claim))) problems.push('claim is not exact text in the submitted output or artifact');
    const tokens = arithmeticTokens(d.expression);
    const got = tokens && tokens.length <= 256 ? evaluateExpression(d.expression) : null;
    const want = figureValue(d.value);
    if (got === null || want === null) problems.push('expression or value is not finite bounded arithmetic');
    else if (!numericEqual(d.decimalPlaces === undefined ? got : rounded(got, d.decimalPlaces), want, tokens?.length))
      problems.push(`expression comes to ${String(got)}, not ${d.value}; declare decimalPlaces only for intentional rounding`);
    const values = new Set<number>();
    for (const o of d.operands) {
      const value = figureValue(o.value);
      if (value === null) {
        problems.push(`operand ${o.value} is not a figure`);
        continue;
      }
      if (o.derivationId) {
        const prior = byId.get(o.derivationId);
        if (!prior || check(prior).status !== 'checked' || !numericEqual(figureValue(prior.value) ?? NaN, value))
          problems.push(`operand ${o.value} has no valid intermediate ${o.derivationId}`);
        else values.add(value);
      } else {
        const r = input.resolve?.(o.ref!);
        let own = false;
        if (r?.path) {
          try {
            own = input.excludedPaths?.has(realpathSync(r.path)) ?? false;
          } catch {
            own = input.excludedPaths?.has(r.path) ?? false;
          }
        }
        if (
          !input.evidence.some((e) => e.ref === o.ref) ||
          !r?.text ||
          r.provenance === 'unverified' ||
          r.supersededBy ||
          own ||
          !quote(r.text).includes(quote(o.excerpt!)) ||
          !citedFiguresIn(o.excerpt!, true).some((f) => numericEqual(figureValue(f) ?? NaN, value))
        )
          problems.push(`operand ${o.value} is not bound to its own cited held excerpt (${o.ref})`);
        else values.add(value);
      }
    }
    for (const t of tokens ?? []) {
      const value = figureValue(t);
      if (value !== null && !CONSTANTS.has(normalizeFigure(t)) && ![...values].some((v) => numericEqual(v, value)))
        problems.push(`operand ${normalizeFigure(t)} needs its own source binding or valid intermediate`);
    }
    visiting.delete(d.id);
    const result: ArithmeticResult = {
      id: d.id,
      claim: d.claim,
      value: d.value,
      status: problems.length ? 'invalid' : 'checked',
      semanticSupportVerified: false,
      operands: d.operands,
      problems,
    };
    results.set(d.id, result);
    return result;
  }
  ds.forEach(check);
  return {
    results: ds.map((d) => results.get(d.id)!),
    problems: [...results.values()].flatMap((r) => r.problems.map((p) => `derivation ${r.id}: ${p}`)),
  };
}
/** Only the result's own claim can use this calculation as numeric grounding. */
export function withoutDerivedFigures(text: string, results: readonly ArithmeticResult[]): string {
  const claims = new Map<string, number[]>();
  for (const r of results) {
    const value = figureValue(r.value);
    if (r.status === 'checked' && value !== null) claims.set(r.claim, [...(claims.get(r.claim) ?? []), value]);
  }
  for (const [claim, values] of claims) {
    const masked = claim.replace(/[$€£]?\d[\d,]*(?:\.\d+)?\s?(?:%|[kKmMbB]\b|ms\b|h\b|x\b)?/g, (f) =>
      values.some((value) => numericEqual(figureValue(f) ?? NaN, value)) ? 'checked-result ' : f,
    );
    text = text.split(claim).join(masked);
  }
  return text;
}
