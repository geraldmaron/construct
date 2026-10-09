/** An explicitly invoked host command observes a predefined independent evaluation.
 * No MCP tool executes this command. It grants no permission or universal quality claim.
 */
import { spawn } from 'node:child_process';
import { relative } from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { appendActivity } from '../kernel/state/activity.ts';
import type { StateStore } from '../kernel/state/open.ts';
import type { RegisteredSkill } from '../kernel/registry/models.ts';
import { validateQualificationSuite, type QualificationRecord } from '../kernel/registry/qualification-evidence.ts';
import { contentReceipt } from '../kernel/workflow/verification.ts';
import type { RefResolver } from '../kernel/project/evidence.ts';
import { redact } from '../kernel/render/redact.ts';
import { safeEnvironment } from './delegation/workspace.ts';

export async function evaluateSkill(input: { store: StateStore; skill: RegisteredSkill; suitePath: string; root: string; env: NodeJS.ProcessEnv; now: () => string; resolve: RefResolver; timeoutMs?: number; validForHours?: number }) {
  const bytes = readFileSync(input.suitePath);
  if (bytes.length > 256 * 1024) throw new Error('qualification suite exceeds 256 KiB');
  const suite = validateQualificationSuite(JSON.parse(bytes.toString()));
  const suiteDigest = createHash('sha256').update(bytes).digest('hex');
  const timeoutMs = input.timeoutMs ?? 120_000, validForHours = input.validForHours ?? 24 * 7;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1_200_000 || !Number.isFinite(validForHours) || validForHours <= 0 || validForHours > 24 * 30) throw new Error('evaluation timeout/expiry exceeds its bounded envelope');
  const verifierRefs = [relative(input.root, input.suitePath), ...suite.verifier.files];
  const verifierEvidence = verifierRefs.map((ref) => contentReceipt(ref, input.resolve));
  if (verifierEvidence.some((entry) => entry.digest === null || entry.provenance !== 'witnessed')) throw new Error('suite and verifier files must be held project evidence');
  const startedAt = input.now();
  let stdout = '', stderr = '', oversized = false, timedOut = false;
  const exitStatus = await new Promise<number | null>((accept, reject) => {
    const child = spawn(suite.verifier.argv[0]!, suite.verifier.argv.slice(1), { cwd: input.root, env: safeEnvironment(input.env), shell: false, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    const stop = () => { try { if (process.platform === 'win32') child.kill('SIGKILL'); else process.kill(-child.pid!, 'SIGKILL'); } catch { /* exited */ } };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    const interrupt = () => stop();
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    const cleanup = () => { clearTimeout(timer); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); };
    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); if (Buffer.byteLength(stdout) > 256 * 1024) { oversized = true; stdout = stdout.slice(0, 256 * 1024); stop(); } });
    child.stderr.on('data', (data: Buffer) => { stderr = (stderr + data.toString()).slice(0, 4096); });
    child.on('error', (error) => { cleanup(); reject(error); });
    child.on('close', (code) => { cleanup(); accept(code); });
  });
  const endedAt = input.now(), problems: string[] = [];
  if (exitStatus !== 0 || timedOut || oversized) problems.push('evaluation command failed, timed out or exceeded its output budget');
  if (createHash('sha256').update(readFileSync(input.suitePath)).digest('hex') !== suiteDigest) problems.push('suite changed while evaluation ran');
  let results: any;
  try { results = JSON.parse(stdout); } catch { problems.push('evaluator did not return one JSON result'); }
  if (results?.formatVersion !== 1 || !Array.isArray(results?.cases)) problems.push('evaluation needs formatVersion 1 and case results');
  const cases = Array.isArray(results?.cases) ? results.cases.filter((entry: unknown) => entry !== null && typeof entry === 'object' && !Array.isArray(entry)) : [];
  if (cases.length !== suite.cases.length || new Set(cases.map((c: any) => c.id)).size !== cases.length || cases.some((c: any) => !suite.cases.some((s) => s.id === c.id))) problems.push('evaluation case identities do not exactly match the predetermined suite');
  const refs = new Set<string>();
  for (const expected of suite.cases) {
    const observed = cases.find((c: any) => c.id === expected.id);
    if (!observed || expected.checks.some((name) => observed.checks?.[name] !== 'pass')) problems.push(`${expected.id}: a required independent check did not pass`);
    if (typeof observed?.producerSession !== 'string' || typeof observed?.reviewerSession !== 'string' || !observed.producerSession || !observed.reviewerSession || observed.producerSession === observed.reviewerSession) problems.push(`${expected.id}: producer and independent reviewer identities are required`);
    if (!Array.isArray(observed?.evidence) || !observed.evidence.length || observed.evidence.some((ref: unknown) => typeof ref !== 'string')) problems.push(`${expected.id}: evaluation evidence references are required`);
    else observed.evidence.forEach((ref: string) => refs.add(ref));
  }
  if (verifierEvidence.some((entry) => contentReceipt(entry.ref, input.resolve).digest !== entry.digest)) problems.push('verifier code changed during evaluation');
  const evidence = [...verifierEvidence, ...[...refs].map((ref) => contentReceipt(ref, input.resolve))];
  if (evidence.some((entry) => entry.digest === null || entry.provenance !== 'witnessed')) problems.push('evaluation evidence must be held, witnessed content');
  const record: QualificationRecord = { formatVersion: 1, skill: { id: input.skill.manifest.id, version: input.skill.manifest.version, digest: input.skill.digest }, suite, suiteDigest, startedAt, endedAt, expiresAt: new Date(Date.parse(endedAt) + validForHours * 3_600_000).toISOString(), exitStatus, passed: problems.length === 0, problems, evidence, results: results ?? null };
  // Preserve kernel-computed digests; redact only external text, never the receipt identity.
  const cleaned: QualificationRecord = { ...record, suite: JSON.parse(redact(JSON.stringify(suite))), results: results === undefined ? null : JSON.parse(redact(JSON.stringify(results))), problems: problems.map(redact), evidence: evidence.map((entry) => ({ ...entry, ref: redact(entry.ref) })) };
  const event = appendActivity(input.store, { at: endedAt, kind: 'skill.evaluation_observed', actor: 'host evaluation adapter', channel: 'host_evaluation', payload: cleaned });
  return { evaluationRef: `evaluation:${event.id}`, ...cleaned, stderr: redact(stderr), limitation: 'Scoped executed evaluator result; reviewer judgments remain fallible and host/model labels describe this suite. No permission or universal qualification is inferred.' };
}
