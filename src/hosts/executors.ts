/** Explicit, bounded handoff to an installed host CLI. The host owns the model
 * and sandbox; Construct owns the existing durable run and does not loop a model.
 */
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { findOnPath } from './presence.ts';
import { WIRABLE_CLIENTS, LAUNCHER } from './wiring/clients.ts';

export function runnerCapabilities(executor: string): readonly string[] {
  return executor === 'codex' || executor.startsWith('runner:codex:')
    ? ['model_review', 'write_project_files', 'run_tests', 'ask_user'] : [];
}
export function executorSupport(): readonly { host: string; supported: boolean; reason: string }[] {
  return WIRABLE_CLIENTS.map((host) => ({ host, supported: host === 'codex', reason: host === 'codex' ? 'Explicit local CLI handoff; local files and Construct runner tools; external connectors need a separately provisioned adapter.' : 'No verified unattended adapter is shipped for this host. Interactive MCP use is independent of executor support.' }));
}
const probe = (binary: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> => new Promise((accept, reject) => {
  execFile(binary, args, { env, timeout: 10_000, maxBuffer: 128_000 }, (error, stdout, stderr) => error ? reject(new Error('executor probe failed; authenticate or repair the host CLI before scheduling')) : accept(stdout + stderr));
});
export async function prepareExecutor(id: string, env: NodeJS.ProcessEnv): Promise<{ id: string; binary: string; version: string }> {
  if (id !== 'codex') throw new Error(`unprovisioned executor ${id}; no unattended adapter for this host (see workflow executors)`);
  const binary = findOnPath('codex', env);
  if (!binary) throw new Error('unprovisioned executor codex: no executable on PATH');
  const version = (await probe(binary, ['--version'], env)).trim();
  const login = await probe(binary, ['login', 'status'], env);
  if (!/Logged in/i.test(login)) throw new Error('unprovisioned executor codex: no authenticated host session');
  return { id, binary, version };
}
export function executorCommand(input: { root: string; runId: string; executorId: string; launcher?: string }): string[] {
  const server = ['serve', '--headless', '--client=codex', `--executor=${input.executorId}`, `--project=${input.root}`];
  const prompt = `Continue only Construct run ${input.runId} in this project. Bootstrap the runner, claim_step with that runId, apply its bound method and instructions, then submit_work. Repeat until succeeded, blocked, cancelled, or waiting for a person. Use your existing sandbox for local reads, artifact writes and verification commands. Do not start other work, broaden permissions, resolve decisions, publish, install software, or use an external service. A declared capability is not proof of execution. Hand back the actual final run state and unresolved limits.`;
  return ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '--disable', 'plugins', '--sandbox', 'workspace-write', '--cd', input.root,
    '-c', 'mcp_servers.construct.command=' + JSON.stringify(process.execPath),
    '-c', 'mcp_servers.construct.args=' + JSON.stringify([input.launcher ?? LAUNCHER, ...server]),
    '-c', 'mcp_servers.construct.default_tools_approval_mode="approve"', prompt];
}
export async function executeRun(input: { binary: string; root: string; runId: string; executorId: string; env: NodeJS.ProcessEnv; timeoutMs?: number; onEvent?: (event: unknown) => void }): Promise<{ exitStatus: number | null; signal: string | null; timedOut: boolean; transcriptDigest: string; events: number }> {
  const timeout = input.timeoutMs ?? 15 * 60_000;
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 60 * 60_000) throw new Error('executor timeout must be between 1 and 3600000 milliseconds');
  const hash = createHash('sha256'); let timedOut = false, events = 0;
  return new Promise((accept, reject) => {
    const child = spawn(input.binary, executorCommand(input), { cwd: input.root, env: input.env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    const stop = () => { try { if (process.platform === 'win32') child.kill('SIGKILL'); else process.kill(-child.pid!, 'SIGKILL'); } catch { /* already ended */ } };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeout);
    const onSignal = () => { timedOut = true; stop(); };
    process.once('SIGTERM', onSignal); process.once('SIGINT', onSignal);
    child.stderr.on('data', (bytes: Buffer) => hash.update(bytes));
    createInterface({ input: child.stdout }).on('line', (line) => {
      try {
        const event = JSON.parse(line) as { type?: string; item?: { type?: string } };
        if (/reasoning|analysis/.test(event.type ?? '') || event.item?.type === 'reasoning') return;
        hash.update(line); events += 1; input.onEvent?.(event);
      } catch { hash.update(line); }
    });
    const cleanup = () => { clearTimeout(timer); process.removeListener('SIGTERM', onSignal); process.removeListener('SIGINT', onSignal); stop(); };
    child.on('error', () => { cleanup(); reject(new Error('executor could not start; no fallback attempted')); });
    child.on('close', (exitStatus, signal) => { cleanup(); accept({ exitStatus, signal, timedOut, transcriptDigest: hash.digest('hex'), events }); });
  });
}
