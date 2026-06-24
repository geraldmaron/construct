/**
 * lib/providers/secret-resolver.mjs — single credential resolver for the LLM path.
 *
 * Resolves a canonical environment variable (for example ANTHROPIC_API_KEY) by
 * walking the same sources the rest of Construct trusts, in priority order:
 * process env, the XDG config dir config.env, ~/.env, the project .env, then shell rc
 * files (.zshrc/.bashrc/.bash_profile/.profile). When the value carries a
 * 1Password reference — a bare `op://vault/item/field` or the shell form
 * `$(op read 'op://...')` — it is resolved through the `op` CLI and cached for
 * the process lifetime so a single launch prompts at most once per reference.
 *
 * resolveSecret performs the `op read` (and may surface a structured
 * SecretResolutionError); hasSecret only checks presence and never invokes the
 * CLI, so detection stays fast and free of biometric prompts. The plaintext
 * value lives only in this module's cache and is never logged. allowAmbient lets
 * a hermetic caller (tests, embedded callers that inject their own env) suppress
 * file/rc discovery so a developer key never bleeds into an isolated run.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { discoverAlternateRawForVar } from './credential-sources.mjs';
import { configDir } from '../config/xdg.mjs';

// The 1Password desktop integration prompts for biometric unlock on the first
// read after the vault locks, and that interactive round-trip routinely takes
// 7–8s — well past a snappy 5s budget. Allow enough headroom that an approved
// Touch ID unlock resolves instead of being killed mid-prompt; cached reads
// afterward return in well under a second.
const OP_READ_TIMEOUT_MS = 20000;

const opCache = new Map();

export class SecretResolutionError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SecretResolutionError';
    this.code = code;
  }
}

function unquote(value) {
  return String(value).trim().replace(/^(['"])([\s\S]*)\1$/, '$2').trim();
}

// Two op:// carriers are accepted: a bare reference, or the `$(op read '...')`
// command-substitution form commonly written into dotenv and shell rc files.

export function extractOpRef(rawValue) {
  if (!rawValue) return null;
  const value = unquote(rawValue);
  if (value.startsWith('op://')) return value;
  const m = value.match(/\$\(\s*op\s+read\s+(['"]?)(op:\/\/[^'")\s]+)\1\s*\)/);
  return m ? m[2] : null;
}

function defaultOpRead(opRef) {
  const result = spawnSync('op', ['read', opRef], { encoding: 'utf8', timeout: OP_READ_TIMEOUT_MS });
  if (result.error && result.error.code === 'ENOENT') {
    throw new SecretResolutionError('1Password CLI not found — install `op` or set the key directly.', 'OP_NOT_INSTALLED');
  }
  if (result.status !== 0) {
    const stderr = String(result.stderr || '').toLowerCase();
    if (/sign in|signin|session|not currently|authenticate|authorization|no account/.test(stderr)) {
      throw new SecretResolutionError('1Password CLI is not signed in — run `op signin` and retry.', 'OP_NOT_SIGNED_IN');
    }
    throw new SecretResolutionError(`op read failed for ${opRef}: ${String(result.stderr || '').trim().slice(0, 160)}`, 'OP_READ_FAILED');
  }
  const secret = String(result.stdout || '').trim();
  if (!secret) throw new SecretResolutionError(`op read returned an empty value for ${opRef}`, 'OP_EMPTY');
  return secret;
}

export function resolveOpRef(opRef, { opRead = defaultOpRead } = {}) {
  if (opCache.has(opRef)) return opCache.get(opRef);
  const secret = opRead(opRef);
  opCache.set(opRef, secret);
  return secret;
}

function materialize(rawValue, opts) {
  const ref = extractOpRef(rawValue);
  return ref ? resolveOpRef(ref, opts) : unquote(rawValue);
}

function readDotenvVar(file, varName) {
  try {
    if (!fs.existsSync(file)) return null;
    const m = fs.readFileSync(file, 'utf8').match(new RegExp(`^${varName}=(.+)$`, 'm'));
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function readShellRcVar(varName, home) {
  const files = ['.zshrc', '.bashrc', '.bash_profile', '.profile'].map((f) => path.join(home, f));
  for (const rc of files) {
    try {
      if (!fs.existsSync(rc)) continue;
      const m = fs.readFileSync(rc, 'utf8').match(new RegExp(`^\\s*export\\s+${varName}=(.+)$`, 'm'));
      if (m) return m[1].trim();
    } catch {
      continue;
    }
  }
  return null;
}

function rawCandidate(varName, { env, cwd, home }) {
  const direct = env?.[varName];
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const files = [path.join(configDir(home), 'config.env'), path.join(home, '.env'), path.join(cwd, '.env')];
  for (const file of files) {
    const value = readDotenvVar(file, varName);
    if (value) return value;
  }
  const alt = discoverAlternateRawForVar(varName, { home });
  if (alt) return alt;
  return readShellRcVar(varName, home);
}

export function resolveSecret(varName, { env = process.env, cwd = process.cwd(), allowAmbient = true, opRead } = {}) {
  const direct = env?.[varName];
  if (typeof direct === 'string' && direct.length > 0) return materialize(direct, { opRead });
  if (!allowAmbient) return null;
  const home = os.homedir();
  const raw = rawCandidate(varName, { env, cwd, home });
  return raw ? materialize(raw, { opRead }) : null;
}

export function resolveFirstSecret(varNames, opts = {}) {
  for (const name of varNames) {
    const value = resolveSecret(name, opts);
    if (value) return value;
  }
  return null;
}

// Presence check that never runs `op read`: a stored op:// reference counts as
// configured because the plaintext is resolved lazily at call time.

export function hasSecret(varName, { env = process.env, cwd = process.cwd(), allowAmbient = true } = {}) {
  const direct = env?.[varName];
  if (typeof direct === 'string' && direct.length > 0) return true;
  if (!allowAmbient) return false;
  const home = os.homedir();
  const raw = rawCandidate(varName, { env, cwd, home });
  return typeof raw === 'string' && raw.length > 0;
}

export function hasAnySecret(varNames, opts = {}) {
  return varNames.some((name) => hasSecret(name, opts));
}

export function __clearSecretCache() {
  opCache.clear();
}
