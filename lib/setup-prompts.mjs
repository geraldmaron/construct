/**
 * lib/setup-prompts.mjs — yes/no consent helper for `construct init`.
 *
 * Centralises the "should we install this service?" decision so Postgres,
 * telemetry, and any future service share the same prompt + consent-caching
 * behavior. Pattern matches Supabase CLI / Hasura / Husky: interactive
 * default-yes prompt, persisted answer so re-runs are silent.
 *
 * Decision tree:
 *   1. alreadyConfigured  → false  (user has an external service, leave alone)
 *   2. consent cached     → return cached value silently
 *   3. isYes flag         → true, cache as yes
 *   4. non-TTY            → false  (CI / scripts — caller can use --yes to opt in)
 *   5. interactive        → prompt [Y/n], cache the answer
 *
 * Consent is stored as BOOTSTRAP_<NAME>=yes|no in ~/.config/construct/config.env
 * so subsequent runs of `construct init` don't re-prompt for the same
 * services. Pass `force = true` to skip the cache and re-prompt.
 */

import readline from 'node:readline';

import { parseEnvFile, writeEnvValues } from './env-config.mjs';

export async function consentToInstall({
  name,
  isYes = false,
  force = false,
  alreadyConfigured = false,
  alreadyConfiguredNote = '',
  envPath,
  question = '',
  defaultYes = true,
  readlineModule = readline,
  stdin = process.stdin,
  stdout = process.stdout,
} = {}) {
  if (!name) throw new Error('consentToInstall: name is required');
  if (!envPath) throw new Error('consentToInstall: envPath is required');

  if (alreadyConfigured) {
    return { decision: false, source: 'pre-configured', note: alreadyConfiguredNote || `${name} already configured` };
  }

  const consentKey = consentKeyFor(name);
  const env = parseEnvFile(envPath);
  const cached = env[consentKey];

  if (!force && cached) {
    if (cached === 'yes' || cached === 'true' || cached === '1') {
      return { decision: true, source: 'cached', note: `using cached BOOTSTRAP_${name.toUpperCase()}=yes` };
    }
    if (cached === 'no' || cached === 'false' || cached === '0' || cached === 'never') {
      return { decision: false, source: 'cached', note: `using cached BOOTSTRAP_${name.toUpperCase()}=${cached}` };
    }
  }

  if (isYes) {
    writeEnvValues(envPath, { [consentKey]: 'yes' });
    return { decision: true, source: 'flag', note: '--yes flag accepted defaults' };
  }

  if (!stdin.isTTY) {
    return { decision: false, source: 'non-tty', note: 'non-interactive shell — re-run with --yes to opt into local services' };
  }

  const answer = await promptYesNo({
    question: question || `Install local ${name} via Docker?`,
    defaultYes,
    readlineModule,
    stdin,
    stdout,
  });
  writeEnvValues(envPath, { [consentKey]: answer ? 'yes' : 'no' });
  return { decision: answer, source: 'prompt', note: answer ? 'user accepted' : 'user declined' };
}

function consentKeyFor(name) {
  return `BOOTSTRAP_${String(name).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
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

export const _consentKeyFor = consentKeyFor;
