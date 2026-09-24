/**
 * cli/holders.ts — which other processes have a file open. SQLite cannot see
 * an idle connection in another process, so this asks the operating system.
 * Where the question cannot be asked (no lsof), the answer is none, so a
 * command that asks still tells the person what to stop first.
 */

import { spawnSync } from 'node:child_process';

/** Other processes that have `path` open, by pid; never this process. */
export function processesHolding(path: string): number[] {
  const r = spawnSync('lsof', ['-t', '--', path], { encoding: 'utf8' });
  if (r.error || typeof r.stdout !== 'string') return [];
  return r.stdout.split('\n').map((l) => Number(l.trim())).filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
}
