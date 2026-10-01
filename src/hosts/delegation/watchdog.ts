import { spawn, type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

interface Launch {
  readonly command: string;
  readonly args: string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly prompt: string;
  readonly timeoutMs: number;
}

let worker: ChildProcess | null = null;
let reason: string | null = null;
let output = '';
let outputBytes = 0;
let started = false;
const decoder = new StringDecoder('utf8');
let deadline: ReturnType<typeof setTimeout> | null = null;

function terminate(why: string): void {
  reason ??= why;
  if (deadline) clearTimeout(deadline);
  if (!worker?.pid) { process.exit(0); return; }
  try { process.kill(-worker.pid, 'SIGKILL'); } catch {}
}

process.on('disconnect', () => terminate('supervisor_lost'));
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(signal, () => terminate('cancelled'));
process.on('message', (message: Launch | { cancel: true }) => {
  if ('cancel' in message) { terminate('cancelled'); return; }
  if (started) return;
  started = true;
  deadline = setTimeout(() => terminate('timed_out'), message.timeoutMs);
  worker = spawn(message.command, message.args, { cwd: message.cwd, env: message.env, detached: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
  process.send?.({ groupPid: worker.pid ?? null });
  worker.stdin?.on('error', () => {});
  worker.stdin?.end(message.prompt);
  worker.stdout?.on('data', (chunk: Buffer) => {
    outputBytes += chunk.length;
    if (outputBytes > 1024 * 1024) terminate('output_limit');
    else output += decoder.write(chunk);
  });
  worker.stderr?.on('data', (chunk: Buffer) => {
    outputBytes += chunk.length;
    if (outputBytes > 1024 * 1024) terminate('output_limit');
  });
  worker.on('error', () => { reason = 'launch_failed'; });
  worker.on('exit', () => {
    if (worker?.pid) { try { process.kill(-worker.pid, 'SIGKILL'); } catch {} }
  });
  worker.on('close', code => {
    output += decoder.end();
    if (deadline) clearTimeout(deadline);
    if (worker?.pid) { try { process.kill(-worker.pid, 'SIGKILL'); } catch {} }
    if (process.connected) process.send?.({ output, code, reason }, () => process.exit(0));
    else process.exit(0);
  });
});
