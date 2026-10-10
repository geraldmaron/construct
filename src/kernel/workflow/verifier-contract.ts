/** Freeze intended verification before production; execution alone is insufficient. */
import { createHash } from 'node:crypto';
import type { StateStore } from '../state/open.ts';
import { listSteps } from '../state/steps.ts';
import type { RefResolver } from '../project/evidence.ts';
import { contentReceipt, artifactRefs, type ContentReceipt } from './verification.ts';

export interface VerifierContract {
  readonly id: string;
  readonly version: string;
  readonly argv: readonly string[];
  readonly files: readonly string[];
  readonly checks: readonly string[];
}
export interface FrozenVerifier { readonly contract: VerifierContract; readonly digest: string; readonly files: readonly ContentReceipt[]; }
export function parseVerifierContract(value: unknown): VerifierContract {
  const v = value as VerifierContract;
  if (!v || typeof v.id !== 'string' || !v.id.trim() || typeof v.version !== 'string' || !v.version.trim()) throw new Error('verificationContract needs id and version');
  for (const name of ['argv', 'files', 'checks'] as const) if (!Array.isArray(v[name]) || !v[name].length || v[name].length > 100 || v[name].some((x) => typeof x !== 'string' || !x.trim() || x.includes('\0') || x.length > 4000)) throw new Error(`verificationContract ${name} must be a bounded nonempty string array`);
  if (new Set(v.checks).size !== v.checks.length) throw new Error('verificationContract checks must be unique');
  return { id: v.id, version: v.version, argv: [...v.argv], files: [...new Set(v.files)], checks: [...v.checks] };
}
export function selectedVerifier(store: StateStore, runId: string): FrozenVerifier | null {
  for (const step of listSteps(store, runId)) {
    const out = step.output as { verificationContractReceipt?: FrozenVerifier } | null;
    if (step.state === 'succeeded' && out?.verificationContractReceipt) return out.verificationContractReceipt;
  }
  return null;
}
export function freezeVerifier(store: StateStore, runId: string, value: unknown, resolve: RefResolver | undefined): FrozenVerifier {
  if (selectedVerifier(store, runId)) throw new Error('verification contract is already frozen; start revised work instead of replacing its criteria');
  if (listSteps(store, runId).some((step) => artifactRefs(step.output).length)) throw new Error('verification contract must be recorded before production artifacts are submitted');
  const contract = parseVerifierContract(value);
  const files = contract.files.map((ref) => {
    const hit = resolve?.(ref);
    if (!hit || hit.kind !== 'file' || hit.provenance !== 'witnessed' || typeof hit.text !== 'string' || hit.truncated) throw new Error(`verifier code/rubric must be a witnessed complete project file: ${ref}`);
    return contentReceipt(ref, resolve);
  });
  return { contract, digest: createHash('sha256').update(JSON.stringify({ contract, files })).digest('hex'), files };
}
export function verifierProblems(frozen: FrozenVerifier, argv: readonly string[], resolve: RefResolver | undefined, observedArgvDigest?: string): string[] {
  const problems: string[] = [];
  if (observedArgvDigest ? observedArgvDigest !== createHash('sha256').update(JSON.stringify(frozen.contract.argv)).digest('hex') : JSON.stringify(frozen.contract.argv) !== JSON.stringify(argv)) problems.push('command differs from the intended verification contract');
  if (frozen.files.some((f) => !resolve || f.digest === null || contentReceipt(f.ref, resolve).digest !== f.digest)) problems.push('intended verifier code or rubric changed after the contract was frozen');
  return problems;
}
export function contractResult(frozen: FrozenVerifier, stdout: string): { satisfied: boolean; checks: Readonly<Record<string, unknown>>; problems: string[] } {
  let checks: Record<string, unknown> = {};
  const problems: string[] = [];
  try {
    const result = JSON.parse(stdout) as { formatVersion?: number; checks?: unknown };
    if (result.formatVersion !== 1 || !result.checks || typeof result.checks !== 'object' || Array.isArray(result.checks)) throw new Error('shape');
    checks = result.checks as Record<string, unknown>;
    for (const expected of frozen.contract.checks) if (checks[expected] !== 'pass') problems.push(`intended check ${expected} did not return pass`);
    for (const name of Object.keys(checks)) if (!frozen.contract.checks.includes(name)) problems.push(`unexpected check ${name} cannot substitute for the intended checks`);
  } catch { problems.push('intended verifier must emit one JSON result: {formatVersion:1, checks:{<each intended check>:pass|fail|unknown}}'); }
  return { satisfied: problems.length === 0, checks, problems };
}
