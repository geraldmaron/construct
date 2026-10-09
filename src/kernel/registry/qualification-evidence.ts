/** Executed qualification is scoped to a concrete evaluator, host and corpus. */
import type { StateStore } from '../state/open.ts';
import type { ContentReceipt } from '../workflow/verification.ts';

export const QUALIFICATION_COVERAGE = ['explicit', 'implicit', 'contextual', 'negative', 'held_out', 'composition'] as const;
export interface QualificationSuite {
  readonly formatVersion: 1;
  readonly id: string;
  readonly version: string;
  readonly scope: string;
  readonly host: string;
  readonly model: string;
  readonly verifier: { readonly id: string; readonly version: string; readonly argv: readonly string[]; readonly files: readonly string[] };
  readonly cases: readonly { readonly id: string; readonly kind: typeof QUALIFICATION_COVERAGE[number]; readonly domain: string; readonly checks: readonly string[] }[];
}
export interface QualificationRecord {
  readonly formatVersion: 1;
  readonly skill: { readonly id: string; readonly version: string; readonly digest: string };
  readonly suite: QualificationSuite;
  readonly suiteDigest: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly expiresAt: string;
  readonly exitStatus: number | null;
  readonly passed: boolean;
  readonly problems: readonly string[];
  readonly evidence: readonly ContentReceipt[];
  readonly results: unknown;
}
export function qualificationRecords(store: StateStore, skillId: string): { id: number; record: QualificationRecord }[] {
  return (store.db.prepare("SELECT id, payload_json FROM activity_events WHERE kind = 'skill.evaluation_observed' AND channel = 'host_evaluation' AND json_extract(payload_json, '$.skill.id') = ? ORDER BY id DESC").all(skillId) as { id: number; payload_json: string }[]).map((row) => ({ id: row.id, record: JSON.parse(row.payload_json) as QualificationRecord }));
}
export function validateQualificationSuite(value: unknown): QualificationSuite {
  const suite = value as QualificationSuite;
  const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 2000;
  if (!suite || suite.formatVersion !== 1 || ![suite.id, suite.version, suite.scope, suite.host, suite.model, suite.verifier?.id, suite.verifier?.version].every(text)) throw new Error('qualification suite needs version, identity, scope, host/model and verifier identity');
  if (!Array.isArray(suite.verifier.argv) || !suite.verifier.argv.length || suite.verifier.argv.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) throw new Error('suite verifier.argv must be an explicit argument array');
  if (!Array.isArray(suite.verifier.files) || !suite.verifier.files.length || suite.verifier.files.some((ref) => !text(ref))) throw new Error('suite verifier needs its project code/file references for invalidation');
  if (!Array.isArray(suite.cases) || suite.cases.length < QUALIFICATION_COVERAGE.length || suite.cases.length > 200 || new Set(suite.cases.map((c) => c.id)).size !== suite.cases.length) throw new Error('qualification requires unique bounded cases');
  for (const item of suite.cases) if (!text(item.id) || !text(item.domain) || !QUALIFICATION_COVERAGE.includes(item.kind) || !Array.isArray(item.checks) || !item.checks.length || item.checks.some((c: unknown) => !text(c)) || new Set(item.checks).size !== item.checks.length) throw new Error('each qualification case needs kind, domain and predetermined unique checks');
  if (QUALIFICATION_COVERAGE.some((kind) => !suite.cases.some((c) => c.kind === kind))) throw new Error('qualification requires explicit, implicit, contextual, negative, held_out and composition coverage');
  if (new Set(suite.cases.map((c) => c.domain)).size < 2) throw new Error('qualification needs more than one domain');
  return suite;
}
