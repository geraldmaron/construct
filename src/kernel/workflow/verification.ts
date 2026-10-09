import { runSemanticProblems } from './semantic-review.ts';
import { selectedVerifier, verifierProblems } from './verifier-contract.ts';
import type { StateStore } from '../state/open.ts';
import type { WorkflowStep } from '../registry/models.ts';
import { getRun } from '../state/runs.ts';
import { listSteps, type StepRun } from '../state/steps.ts';
/** Kernel content receipts separate byte identity and deterministic checks from host-reported execution. */
import { createHash } from 'node:crypto';
import type { RefResolver } from '../project/evidence.ts';

export interface ContentReceipt {
  readonly ref: string;
  readonly digest: string | null;
  readonly provenance: string;
}
export interface VerificationReceipt {
  readonly formatVersion: 1;
  readonly runId: string;
  readonly stepRunId: string;
  readonly observedAt: string;
  readonly actor: string;
  readonly assurance: 'structural';
  readonly executionVerified: false;
  readonly semanticSupportVerified: false;
  readonly subjects: readonly ContentReceipt[];
  readonly evidence: readonly ContentReceipt[];
  /** Earlier source bytes intentionally edited as production artifacts; historical, not current support. */
  readonly baselines?: readonly ContentReceipt[];
  readonly checks: readonly { readonly validator: string; readonly ok: boolean }[];
}

export function contentReceipt(ref: string, resolve?: RefResolver): ContentReceipt {
  const hit = resolve?.(ref);
  return { ref, digest: typeof hit?.text === 'string' ? createHash('sha256').update(hit.text).digest('hex') : null, provenance: hit?.provenance ?? 'unresolved' };
}
export function namedArtifactPath(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    if (typeof object.path === 'string' && object.removed !== true) return object.path.trim() || null;
  }
  return null;
}
export function artifactRefs(output: unknown): string[] {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return [];
  const value = output as Record<string, unknown>;
  return [...new Set([namedArtifactPath(value.artifact), ...(Array.isArray(value.changes) ? value.changes.map(namedArtifactPath) : [])].filter((x): x is string => x !== null))];
}
export function verificationReceipt(input: {
  runId: string; stepRunId: string; observedAt: string; actor: string; subjects: readonly string[];
  priorEvidence?: readonly ContentReceipt[];
  evidence: readonly { readonly ref: string }[]; checks: readonly { readonly validator: string; readonly ok: boolean }[]; resolve?: RefResolver;
}): VerificationReceipt {
  const produced = (ref: string) => sameProducedFile(ref, input.subjects, input.resolve);
  const prior = input.priorEvidence ?? [];
  const held = new Map(prior.filter((e) => !produced(e.ref)).map((e) => [e.ref, e]));
  for (const { ref } of input.evidence) if (!held.has(ref) && !produced(ref)) held.set(ref, contentReceipt(ref, input.resolve));
  return {
    formatVersion: 1, runId: input.runId, stepRunId: input.stepRunId, observedAt: input.observedAt, actor: input.actor,
    assurance: 'structural', executionVerified: false, semanticSupportVerified: false,
    subjects: [...new Set(input.subjects)].map((ref) => contentReceipt(ref, input.resolve)),
    evidence: [...held.values()],
    ...(prior.some((e) => produced(e.ref)) ? { baselines: prior.filter((e) => produced(e.ref)) } : {}),
    checks: input.checks.map(({ validator, ok }) => ({ validator, ok })),
  };
}
/** A prior claim keeps its observed bytes. Legacy citations without receipts stay unwitnessed. */
export function inheritedEvidence(steps: readonly StepRun[]): ContentReceipt[] {
  const held = new Map<string, ContentReceipt>();
  for (const step of steps.filter((s) => s.state === 'succeeded')) {
    const output = step.output as { verificationReceipt?: VerificationReceipt; evidence?: { ref: string }[] } | null;
    for (const entry of output?.verificationReceipt?.evidence ?? []) {
      const key = JSON.stringify([entry.ref, entry.digest, entry.provenance]);
      held.set(key, entry);
    }
    if (!output?.verificationReceipt) for (const { ref } of output?.evidence ?? []) held.set(ref, { ref, digest: null, provenance: 'legacy_unwitnessed' });
  }
  return [...held.values()];
}
function sameProducedFile(ref: string, subjects: readonly string[], resolve?: RefResolver): boolean {
  const hit = resolve?.(ref);
  return hit?.kind === 'file' && subjects.some((subject) => {
    const output = resolve?.(subject);
    return output?.kind === 'file' && (hit.path && output.path ? hit.path === output.path : subject.replace(/^\.\//, '') === ref.replace(/^\.\//, ''));
  });
}
/** Run inputs changing between steps invalidates their derived work, even if the final command passes. */
export function stalePriorEvidence(prior: readonly ContentReceipt[], subjects: readonly string[], resolve?: RefResolver): string[] {
  if (!resolve) return [];
  return [...new Set(prior.filter((entry) => {
    if (entry.digest === null || sameProducedFile(entry.ref, subjects, resolve)) return false;
    const current = contentReceipt(entry.ref, resolve);
    return current.digest !== entry.digest || current.provenance !== entry.provenance;
  }).map((entry) => entry.ref))];
}

/** Missing or changed content cannot inherit a receipt for previously observed bytes. */
export function staleReceiptSubjects(receipt: VerificationReceipt, resolve: RefResolver): string[] {
  return [...new Set([...receipt.subjects, ...receipt.evidence.filter((entry) => entry.digest !== null)].filter((subject) => subject.digest === null || contentReceipt(subject.ref, resolve).digest !== subject.digest).map((subject) => subject.ref))];
}


/** Only a host command adapter observation for this step/attempt can witness execution. */
export function executionCheck(store: StateStore, input: { runId: string; stepRunId: string; attempt: number; output: unknown; resolve?: RefResolver; subjects: readonly string[] }): { ok: boolean; problems: string[]; ref: string | null; observed?: { argv: readonly string[]; exitStatus: number | null } } {
  const out = input.output && typeof input.output === 'object' ? input.output as Record<string, unknown> : {};
  const v = out.verification && typeof out.verification === 'object' ? out.verification as Record<string, unknown> : out;
  const ref = typeof v.executionRef === 'string' ? v.executionRef : null;
  const id = ref?.match(/^execution:(\d+)$/)?.[1];
  const row = id ? store.db.prepare("SELECT payload_json FROM activity_events WHERE id = ? AND kind = 'verification.executed' AND channel = 'host_command' AND run_id = ? AND step_run_id = ?").get(Number(id), input.runId, input.stepRunId) as { payload_json: string } | undefined : undefined;
  if (!row) return { ok: false, ref, problems: ['No observed execution receipt for this step. Run construct run verify inside the host sandbox; a reported result is not execution proof.'] };
  const receipt = JSON.parse(row.payload_json) as { argv: string[]; argvDigest?: string; attempt: number; exitStatus: number | null; timedOut: boolean; signal: string | null; subjectsStable: boolean; subjects: ContentReceipt[]; intendedVerification?: { digest: string; satisfied: boolean; problems: string[] } | null };
  const problems: string[] = [];
  const intended = selectedVerifier(store, input.runId);
  if (intended) {
    problems.push(...verifierProblems(intended, receipt.argv, input.resolve, receipt.argvDigest));
    if (receipt.intendedVerification?.digest !== intended.digest || !receipt.intendedVerification.satisfied) problems.push('execution did not satisfy the frozen intended verification criteria');
  }
  if (v.command !== undefined && v.command !== JSON.stringify(receipt.argv)) problems.push('reported command differs from the observed argv; use command returned by run verify');
  if (v.exitStatus !== undefined && v.exitStatus !== receipt.exitStatus) problems.push('reported exit status differs from the observed exit');
  if (receipt.attempt !== input.attempt) problems.push('execution receipt belongs to a different attempt');
  if (receipt.exitStatus !== 0 || receipt.timedOut || receipt.signal) problems.push('observed verification command did not complete successfully');
  if (!receipt.subjectsStable) problems.push('verification subject changed while the command ran');
  if (input.subjects.some((ref) => !receipt.subjects.some((s) => s.ref === ref))) problems.push('execution receipt does not cover every current artifact');
  if (receipt.subjects.some((s) => s.digest === null || !input.resolve || contentReceipt(s.ref, input.resolve).digest !== s.digest)) problems.push('execution receipt is stale or its subject no longer resolves');
  return { ok: problems.length === 0, problems, ref, observed: { argv: receipt.argv, exitStatus: receipt.exitStatus } };
}


/** An identifier is a persistence claim, not a name the model may invent. */
export function persistedRecordProblems(store: StateStore, output: Record<string, unknown>): string[] {
  const fields: Record<string, readonly string[]> = {
    recordedIds: ['entities', 'claims', 'statements', 'observations', 'drift_findings', 'lessons', 'deliverables', 'work_items'],
    recordedFindingIds: ['drift_findings'],
    lessonIds: ['lessons'],
    decisionIds: ['decisions'],
  };
  const problems: string[] = [];
  for (const [field, tables] of Object.entries(fields)) {
    if (output[field] === undefined) continue;
    const ids = output[field];
    if (!Array.isArray(ids)) { problems.push(`${field} must be an array of existing native record IDs`); continue; }
    for (const id of ids) {
      if (typeof id !== 'string' || !tables.some((table) => !!store.db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id))) problems.push(`${field}: ${String(id)} names no persisted native record; use actual returned IDs, or [] when no additional records were written`);
    }
  }
  return problems;
}


/** A database deliverable cannot silently stand in for a file the user requested. */
export function requestedFileProblems(destination: { kind: string; ref: string | null } | null | undefined, artifacts: readonly string[], resolve?: RefResolver): string[] {
  if (destination?.kind !== 'project_file' || !destination.ref) return [];
  const path = destination.ref.replace(/^\.\//, '');
  const problems: string[] = [];
  if (!artifacts.some((ref) => ref.replace(/^\.\//, '') === path)) problems.push(`requested local destination ${destination.ref} is not named by a produced artifact; write it and submit its artifact path`);
  const hit = resolve?.(destination.ref);
  if (!hit || hit.kind !== 'file' || typeof hit.text !== 'string' || !hit.text.trim()) problems.push(`requested local destination ${destination.ref} is missing, empty or not verifiable as held text`);
  return problems;
}

/** Recheck completion claims, including rows written by older builds. */
export function runExecutionProblems(store: StateStore, runId: string, resolve?: RefResolver): string[] {
  const run = getRun(store, runId);
  if (!run) return ['run does not exist'];
  const frozen = (run.bindings as { steps?: readonly WorkflowStep[] } | null)?.steps;
  if (!Array.isArray(frozen)) return ['run has no frozen step requirements'];
  const rows = listSteps(store, runId);
  const subjects = rows.flatMap((s) => artifactRefs(s.output));
  return [...runSemanticProblems(store, runId, resolve), ...frozen.filter((s) => s.capabilities.includes('run_tests')).flatMap((step) => {
    const row = rows.find((s) => s.stepId === step.id);
    if (!row || row.state !== 'succeeded') return [`${step.id}: required execution step has not succeeded`];
    return executionCheck(store, { runId, stepRunId: row.id, attempt: row.attempts, output: row.output, resolve, subjects }).problems.map((p) => `${step.id}: ${p}`);
  })];
}
