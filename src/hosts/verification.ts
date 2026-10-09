import { selectedVerifier, verifierProblems, contractResult } from '../kernel/workflow/verifier-contract.ts';
/** Execute only from a host-invoked CLI, inside that host's existing sandbox.
 * The MCP server never launches this adapter. A receipt proves this command's
 * observed exit and bytes, not that the chosen command was a sufficient test.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendActivity } from '../kernel/state/activity.ts';
import { getStep, heldLease, listSteps } from '../kernel/state/steps.ts';
import { getRun } from '../kernel/state/runs.ts';
import type { StateStore } from '../kernel/state/open.ts';
import type { RefResolver } from '../kernel/project/evidence.ts';
import { artifactRefs, contentReceipt, type ContentReceipt } from '../kernel/workflow/verification.ts';
import { redact } from '../kernel/render/redact.ts';

export interface CommandWitness {
  readonly formatVersion: 1;
  readonly runId: string;
  readonly stepRunId: string;
  readonly attempt: number;
  readonly owner: string;
  readonly argv: readonly string[];
  readonly argvDigest: string;
  readonly cwd: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly exitStatus: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly outputDigest: string;
  readonly outputExcerpt: string;
  readonly subjects: readonly ContentReceipt[];
  readonly subjectsStable: boolean;
  readonly assurance: 'command_observed';
  readonly intendedVerification: { readonly digest: string; readonly satisfied: boolean; readonly checks: Readonly<Record<string, unknown>>; readonly problems: readonly string[] } | null;
  readonly semanticSupportVerified: false;
}

export async function executeVerification(input: {
  store: StateStore; runId: string; stepRunId: string; token: string; argv: readonly string[];
  root: string; env: NodeJS.ProcessEnv; resolve: RefResolver; now: () => string;
  subjects?: readonly string[]; timeoutMs?: number;
}): Promise<{ executionRef: string; command: string; exitStatus: number | null; receipt: CommandWitness }> {
  const { store } = input;
  if (!input.argv.length || input.argv.some((x) => typeof x !== 'string' || x.includes('\0')) || !input.argv[0]!.trim()) throw new Error('command must be a non-empty array of arguments');
  const step = getStep(store, input.stepRunId);
  const leased = step?.leaseOwner ? heldLease(store, { id: step.id, owner: step.leaseOwner, nonce: input.token }) : null;
  const run = getRun(store, input.runId);
  const startedAt = input.now();
  if (!run || !leased || leased.runId !== run.id || leased.leaseUntil <= startedAt || run.cancelRequested) throw new Error('verification needs the current unexpired step lease of this run');
  const intended = selectedVerifier(store, run.id);
  if (intended) { const problems = verifierProblems(intended, input.argv, input.resolve); if (problems.length) throw new Error(problems.join('; ')); }
  const refs = [...new Set([...(input.subjects ?? []), ...listSteps(store, run.id).flatMap((s) => artifactRefs(s.output))])];
  const subjects = refs.map((ref) => contentReceipt(ref, input.resolve));
  if (subjects.some((s) => s.digest === null)) throw new Error('every verification subject must resolve to held text; unknown or oversized bytes cannot be verified');
  const timeout = input.timeoutMs ?? 120_000;
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 1_200_000) throw new Error('verification timeout must be between 1 and 1200000 milliseconds');
  const hash = createHash('sha256');
  let excerpt = '', stdout = '', stdoutBytes = 0, timedOut = false;
  const result = await new Promise<{ code: number | null; signal: string | null }>((accept, reject) => {
    const child = spawn(input.argv[0]!, input.argv.slice(1), { cwd: input.root, env: input.env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', shell: false });
    const stop = () => { try { if (process.platform === 'win32') child.kill('SIGKILL'); else process.kill(-child.pid!, 'SIGKILL'); } catch { /* exited */ } };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeout);
    const onSignal = () => { timedOut = true; stop(); };
    process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
    const cleanup = () => { clearTimeout(timer); process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal); };
    const read = (data: Buffer) => { hash.update(data); if (excerpt.length < 16_384) excerpt += data.toString('utf8').slice(0, 16_384 - excerpt.length); };
    child.stdout.on('data', (data: Buffer) => { stdoutBytes += data.length; if (stdoutBytes <= 256 * 1024) stdout += data.toString('utf8'); read(data); }); child.stderr.on('data', read);
    child.on('error', (error) => { cleanup(); reject(error); });
    child.on('close', (code, signal) => { cleanup(); accept({ code, signal }); });
  });
  const endedAt = input.now();
  const stillHeld = heldLease(store, { id: leased.id, owner: leased.leaseOwner, nonce: input.token });
  if (!stillHeld || stillHeld.token !== leased.token || stillHeld.leaseUntil <= endedAt) throw new Error('verification completed after its lease was lost; no usable receipt recorded');
  const intendedResult = intended ? contractResult(intended, stdoutBytes > 256 * 1024 ? '' : stdout) : null;
  if (intended && intendedResult) { intendedResult.problems.push(...verifierProblems(intended, input.argv, input.resolve)); intendedResult.satisfied = intendedResult.problems.length === 0 && result.code === 0 && !timedOut && !result.signal; }
  const receipt: CommandWitness = { formatVersion: 1, runId: run.id, stepRunId: leased.id, attempt: leased.token, owner: leased.leaseOwner, argv: input.argv.map(redact), argvDigest: createHash('sha256').update(JSON.stringify(input.argv)).digest('hex'), cwd: input.root, startedAt, endedAt, exitStatus: result.code, signal: result.signal, timedOut, outputDigest: hash.digest('hex'), outputExcerpt: redact(excerpt), subjects, subjectsStable: subjects.every((s) => contentReceipt(s.ref, input.resolve).digest === s.digest), assurance: 'command_observed', intendedVerification: intended && intendedResult ? { digest: intended.digest, ...intendedResult } : null, semanticSupportVerified: false };
  const event = appendActivity(store, { at: endedAt, kind: 'verification.executed', runId: run.id, stepRunId: leased.id, actor: 'host command adapter', channel: 'host_command', payload: receipt });
  return { executionRef: `execution:${event.id}`, command: JSON.stringify(receipt.argv), exitStatus: receipt.exitStatus, receipt };
}
