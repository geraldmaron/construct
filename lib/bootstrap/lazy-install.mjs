/**
 * lib/bootstrap/lazy-install.mjs — on-demand resource installer with consent gating.
 *
 * When a runtime code path needs a resource that is not present, call
 * `lazyInstall(id)`. The function:
 *
 *   1. Reads cached operator consent from config.env (consent key set by the
 *      resource definition in `lib/bootstrap/resources.mjs`).
 *   2. If consent is 'never', returns { installed: false, fallback: <text> }
 *      without prompting or printing anything.
 *   3. If a TTY is available, prompts the user with the resource displayName,
 *      estimated download size, and [y/n/never].
 *   4. On 'y' or an existing 'yes' consent: calls resource.install(), waits
 *      for it to complete, updates config.env, and returns { installed: true }.
 *   5. On 'n': returns { installed: false, fallback: <text> } without saving.
 *   6. On 'never': writes 'never' to config.env and returns { installed: false }.
 *
 * Hooks that run without a TTY (most hook invocations) skip to step 2 and
 * use the fallback silently.
 *
 * Consent is cached per-resource in config.env so the prompt never repeats
 * across process restarts once the user has answered.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';

import { getResource, probeResource } from './resources.mjs';

const CONFIG_ENV = path.join(os.homedir(), '.construct', 'config.env');

function readConfigEnv() {
  try {
    return fs.readFileSync(CONFIG_ENV, 'utf8');
  } catch {
    return '';
  }
}

function readConsentFromEnv(consentKey) {
  const lines = readConfigEnv().split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (k === consentKey) return v;
  }
  return null;
}

function writeConsentToEnv(consentKey, value) {
  let content = readConfigEnv();
  const regex = new RegExp(`^${consentKey}=.*$`, 'm');
  const line = `${consentKey}=${value}`;
  if (regex.test(content)) {
    content = content.replace(regex, line);
  } else {
    content = content.trimEnd() + (content ? '\n' : '') + line + '\n';
  }
  fs.mkdirSync(path.dirname(CONFIG_ENV), { recursive: true });
  fs.writeFileSync(CONFIG_ENV, content, { mode: 0o600 });
}

function hasTty() {
  return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

async function promptUser(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

/**
 * Attempt to install a resource lazily, respecting cached consent.
 *
 * @param {string} id - resource id from the registry
 * @param {object} [opts]
 * @param {boolean} [opts.silent] - skip TTY prompt, use cached consent only
 * @returns {{ installed: boolean, fallback?: string, error?: string }}
 */
export async function lazyInstall(id, { silent = false } = {}) {
  const resource = getResource(id);
  if (!resource) {
    return { installed: false, error: `unknown resource: ${id}` };
  }

  const probe = await probeResource(resource);
  if (probe.present && probe.healthy) {
    return { installed: true };
  }

  const { consentKey, displayName, downloadSize, fallback } = resource;
  const fallbackMsg = typeof fallback === 'function' ? fallback() : (fallback || '');

  const cached = readConsentFromEnv(consentKey);

  if (cached === 'never') {
    return { installed: false, fallback: fallbackMsg };
  }

  if (cached === 'yes') {
    return await performInstall(resource, fallbackMsg);
  }

  if (silent || !hasTty()) {
    return { installed: false, fallback: fallbackMsg };
  }

  const size = downloadSize ? ` (~${formatBytes(downloadSize)})` : '';
  const answer = await promptUser(
    `\n[construct] ${displayName} required${size}. Install now? [y/n/never] `
  );

  if (answer === 'y' || answer === 'yes') {
    writeConsentToEnv(consentKey, 'yes');
    return await performInstall(resource, fallbackMsg);
  }

  if (answer === 'never') {
    writeConsentToEnv(consentKey, 'never');
    process.stderr.write(
      `[construct] "${displayName}" will not be prompted again. Using fallback: ${fallbackMsg}\n`
    );
    return { installed: false, fallback: fallbackMsg };
  }

  return { installed: false, fallback: fallbackMsg };
}

async function performInstall(resource, fallbackMsg) {
  if (typeof resource.install !== 'function') {
    return { installed: false, fallback: fallbackMsg, error: 'resource has no install()' };
  }
  try {
    process.stderr.write(`[construct] Installing ${resource.displayName}...\n`);
    const result = await resource.install();
    if (result?.success) {
      process.stderr.write(`[construct] ${resource.displayName} installed.\n`);
      return { installed: true };
    }
    return { installed: false, fallback: fallbackMsg, error: result?.log };
  } catch (err) {
    return { installed: false, fallback: fallbackMsg, error: err?.message || String(err) };
  }
}
