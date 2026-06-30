/**
 * lib/providers/op-run.mjs — optionally launch a child under 1Password `op run`.
 *
 * When CONSTRUCT_OP_ENV_FILE points to an `op run` env-file (KEY=op://… lines)
 * and the `op` CLI is installed, long-lived Construct services are spawned through
 * `op run --env-file <file> -- <cmd>`, so op:// references resolve once at startup
 * into the process env. lib/service-manager.mjs calls wrapWithOpRun at each service
 * spawn, so the memory server, OpenCode, the copilot bridge, the doctor daemon, and
 * the oracle daemon all inherit resolved provider keys without a per-invocation
 * shell wrapper. Masking stays on so resolved secrets are not echoed to service logs.
 *
 * Strictly opt-in: with the var unset, the file missing, or `op` absent, the
 * command is returned unchanged and 1Password is never invoked. No other setup
 * path forces it.
 */

import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

function expandHome(file, homeDir) {
  if (file === '~') return homeDir;
  if (file.startsWith('~/')) return `${homeDir}${file.slice(1)}`;
  return file;
}

export function resolveOpEnvFile(env = process.env, homeDir = os.homedir()) {
  const raw = env.CONSTRUCT_OP_ENV_FILE;
  if (!raw || !raw.trim()) return null;
  const file = expandHome(raw.trim(), homeDir);
  try {
    return fs.statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

export function opCliAvailable() {
  try {
    return spawnSync('op', ['--version'], { stdio: 'ignore', timeout: 3000 }).status === 0;
  } catch {
    return false;
  }
}

/**
 * Return the command/args to spawn, wrapped in `op run` when opted in. Falls back
 * to the original command unchanged otherwise. `hasOp` is injectable for tests.
 */
export function wrapWithOpRun(command, args = [], { env = process.env, homeDir = os.homedir(), hasOp = opCliAvailable } = {}) {
  const file = resolveOpEnvFile(env, homeDir);
  if (!file || !hasOp()) return { command, args, wrapped: false, envFile: null };
  return {
    command: 'op',
    args: ['run', `--env-file=${file}`, '--', command, ...args],
    wrapped: true,
    envFile: file,
  };
}
