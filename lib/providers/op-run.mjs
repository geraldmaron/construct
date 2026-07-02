/**
 * lib/providers/op-run.mjs — optionally launch Construct under 1Password `op run`.
 *
 * When CONSTRUCT_OP_ENV_FILE points to an `op run` env-file (KEY=op://… lines) and
 * the `op` CLI is installed, `construct dev` re-execs itself once under
 * `op run --env-file <file> -- …` (maybeReExecUnderOpRun). Every op:// reference then
 * resolves a single time at that stable parent — one biometric unlock — and the
 * detached daemons the re-exec'd process spawns inherit the resolved keys through the
 * parent env. A CONSTRUCT_OP_RUN_ACTIVE sentinel marks the wrapped process so nested
 * launches inside it do not re-wrap and re-prompt.
 *
 * wrapWithOpRun stays the per-service fallback for daemons started outside the
 * re-exec'd parent (a doctor or oracle restart from a hook), where no parent
 * resolution has run; under the parent (sentinel set) it returns the command
 * unchanged. The trade-off of resolving once at the parent: `op run` masks the
 * parent's own stdout but not the separate log files of the daemons it detaches, so a
 * daemon that echoes a key logs it unmasked (ADR-0049). The per-service fallback still
 * masks the daemons it wraps directly.
 *
 * Strictly opt-in: with the var unset, the file missing, or `op` absent, the
 * command is returned unchanged and 1Password is never invoked. No other setup
 * path forces it.
 */

import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

// Set on the process env when Construct has already re-exec'd under a parent `op run`.
// Both the parent re-exec and the per-service wrap check it so a single resolution at
// the top of the tree is never nested (which would re-prompt and double-resolve).

export const OP_RUN_ACTIVE_ENV = 'CONSTRUCT_OP_RUN_ACTIVE';

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
  // A parent `op run` already resolved every reference into this env; wrapping again
  // would spawn a nested op run that re-prompts, so hand back the command untouched.
  if (env[OP_RUN_ACTIVE_ENV]) return { command, args, wrapped: false, envFile: null };

  const file = resolveOpEnvFile(env, homeDir);
  if (!file || !hasOp()) return { command, args, wrapped: false, envFile: null };
  return {
    command: 'op',
    args: ['run', `--env-file=${file}`, '--', command, ...args],
    wrapped: true,
    envFile: file,
  };
}

/**
 * Re-exec the current process once under `op run` so every op:// reference in the
 * env-file resolves a single time into the process env; the detached daemons the
 * re-exec'd process then spawns inherit the resolved keys without their own op run.
 * The blocking spawnSync makes the outer process a thin wrapper that exits with the
 * inner status. Returns { reExecuted: false, reason } on every opt-out path — sentinel
 * already set, no resolvable env-file, `op` absent, or a spawn error — so the caller
 * falls through to the normal (per-service-wrap) launch unchanged. `spawnFn` and the
 * process descriptors are injectable for tests.
 */
export function maybeReExecUnderOpRun({
  argv = process.argv,
  execPath = process.execPath,
  env = process.env,
  homeDir = os.homedir(),
  hasOp = opCliAvailable,
  spawnFn = spawnSync,
} = {}) {
  if (env[OP_RUN_ACTIVE_ENV]) return { reExecuted: false, reason: 'already-active' };
  const file = resolveOpEnvFile(env, homeDir);
  if (!file) return { reExecuted: false, reason: 'not-opted-in' };
  if (!hasOp()) return { reExecuted: false, reason: 'op-missing' };

  const scriptArgs = argv.slice(1);
  const childEnv = { ...env, [OP_RUN_ACTIVE_ENV]: '1' };
  const result = spawnFn('op', ['run', `--env-file=${file}`, '--', execPath, ...scriptArgs], {
    stdio: 'inherit',
    env: childEnv,
  });
  if (result?.error) return { reExecuted: false, reason: 'spawn-failed', error: result.error };
  const code = typeof result?.status === 'number' ? result.status : 1;
  return { reExecuted: true, code, envFile: file };
}
