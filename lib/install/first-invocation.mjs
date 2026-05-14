/**
 * lib/install/first-invocation.mjs — one-shot resource probe on first use.
 *
 * Construct's postinstall is silent and idempotent (per the husky / prisma /
 * supabase pattern — npm swallows postinstall output, so prompting from there
 * is unreliable). Instead, the first time a user invokes ANY `construct`
 * command on a machine that hasn't been bootstrapped, this probe runs:
 *   1. Quick check whether `BOOTSTRAP_CHECKED=1` is cached in config.env.
 *      If yes → silent, return immediately.
 *   2. Otherwise, run `probeAll()` from lib/bootstrap/resources.mjs.
 *   3. If everything's healthy → silent, set BOOTSTRAP_CHECKED=1.
 *   4. If anything's missing → print the status table to stderr; on TTY,
 *      prompt to run `construct setup` now. Always set BOOTSTRAP_CHECKED=1
 *      so we don't re-prompt on subsequent commands.
 *
 * Skipped entirely for hook invocations (would corrupt hook output), for
 * `setup`/`uninstall`/`version` (those handle their own flow), and on
 * non-TTY runs (CI / scripts — keep them silent).
 */

import readline from 'node:readline';

import { parseEnvFile, writeEnvValues, getUserEnvPath } from '../env-config.mjs';
import { probeAll, formatProbe } from '../bootstrap/resources.mjs';

const BOOTSTRAP_CHECKED_KEY = 'BOOTSTRAP_CHECKED';
const SKIP_COMMANDS = new Set([
  'hook', 'setup', 'uninstall', 'version', 'help', 'completions', 'doctor',
]);

export function shouldSkipProbe({ command, env = process.env, stdin = process.stdin } = {}) {
  if (!command) return true;
  if (SKIP_COMMANDS.has(command)) return true;
  if (command.startsWith('-')) return true;
  if (env[BOOTSTRAP_CHECKED_KEY] === '1') return true;
  if (env.CONSTRUCT_SKIP_BOOTSTRAP_PROBE === '1') return true;
  return false;
}

export async function maybeFirstInvocationProbe({
  command,
  homeDir,
  env = process.env,
  stdin = process.stdin,
  stdout = process.stderr,
  readlineModule = readline,
  probeAllFn = probeAll,
  formatProbeFn = formatProbe,
  writeEnvFn = writeEnvValues,
} = {}) {
  if (shouldSkipProbe({ command, env, stdin })) {
    return { ran: false, reason: 'skipped' };
  }

  const envPath = getUserEnvPath(homeDir);
  const persisted = parseEnvFile(envPath);
  if (persisted[BOOTSTRAP_CHECKED_KEY] === '1') {
    return { ran: false, reason: 'already-checked' };
  }

  const probes = await probeAllFn();
  const missingRequired = probes.filter((p) => p.required && !p.present);
  const missingOptional = probes.filter((p) => !p.required && !p.present);

  if (missingRequired.length === 0 && missingOptional.length === 0) {
    writeEnvFn(envPath, { [BOOTSTRAP_CHECKED_KEY]: '1' });
    return { ran: true, reason: 'all-healthy', missingRequired: 0, missingOptional: 0 };
  }

  stdout.write('\n[construct] First-run Resource check\n');
  for (const probe of probes) stdout.write(formatProbeFn(probe) + '\n');

  if (missingRequired.length > 0) {
    stdout.write(`\n[construct] ${missingRequired.length} required resource(s) missing. Run \`construct setup\` to install.\n\n`);
  } else {
    stdout.write(`\n[construct] ${missingOptional.length} optional resource(s) missing. Run \`construct setup\` to install (Postgres, Langfuse, embedding model), or continue in degraded mode.\n\n`);
  }

  if (stdin.isTTY && stdout.isTTY !== false) {
    const wants = await promptYesNo({
      question: 'Run `construct setup` now?',
      defaultYes: missingRequired.length > 0,
      readlineModule,
      stdin,
      stdout,
    });
    writeEnvFn(envPath, { [BOOTSTRAP_CHECKED_KEY]: '1' });
    return {
      ran: true,
      reason: 'prompted',
      missingRequired: missingRequired.length,
      missingOptional: missingOptional.length,
      runSetup: wants,
    };
  }

  writeEnvFn(envPath, { [BOOTSTRAP_CHECKED_KEY]: '1' });
  return {
    ran: true,
    reason: 'reported-non-tty',
    missingRequired: missingRequired.length,
    missingOptional: missingOptional.length,
  };
}

async function promptYesNo({ question, defaultYes, readlineModule, stdin, stdout }) {
  const suffix = defaultYes ? '[Y/n]' : '[y/N]';
  return new Promise((resolve) => {
    const rl = readlineModule.createInterface({ input: stdin, output: stdout });
    rl.question(`${question} ${suffix} `, (raw) => {
      rl.close();
      const trimmed = String(raw || '').trim().toLowerCase();
      if (!trimmed) return resolve(defaultYes);
      if (['y', 'yes'].includes(trimmed)) return resolve(true);
      if (['n', 'no'].includes(trimmed)) return resolve(false);
      resolve(defaultYes);
    });
  });
}
