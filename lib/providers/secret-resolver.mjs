/**
 * lib/providers/secret-resolver.mjs — single credential resolver for the LLM path.
 *
 * Resolves a canonical environment variable (for example ANTHROPIC_API_KEY) by
 * walking Construct's credential sources in priority order: a direct value on the
 * passed env, then the project .env, the XDG config dir config.env, ~/.env, the
 * alternate provider stores (Construct creds store, OpenCode provider config), the
 * CONSTRUCT_OP_ENV_FILE catalog, and finally shell rc files
 * (.zshrc/.bashrc/.bash_profile/.profile). The file tier matches loadConstructEnv:
 * the project .env wins over the machine-wide config.env. When the value carries a
 * 1Password reference — a bare `op://vault/item/field` or the shell form
 * `$(op read 'op://...')` — it is resolved through the `op` CLI and cached for
 * the process lifetime so a single launch prompts at most once per reference.
 *
 * One divergence from loadConstructEnv is intentional and tracked separately: that
 * merge ranks the config files above process.env to defeat stale shell exports,
 * while this resolver honors a directly-passed env value first so a hermetic caller
 * can inject its own credentials. Unifying the process.env tier touches the live
 * LLM path and is deferred to a follow-up.
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

let auditSink = null;

// A structured, value-free record of resolution events: which variable, which
// source tier, whether it carried an op:// reference, cache-hit, and the outcome —
// never the materialized secret. The sink defaults to none (hermetic); a caller
// wires it to the observation store. Sink failures never disrupt resolution.

export function setSecretAuditSink(sink) {
  auditSink = typeof sink === 'function' ? sink : null;
}

export function __resetSecretAuditSink() {
  auditSink = null;
}

function emitAudit(event) {
  if (!auditSink) return;
  try {
    auditSink(event);
  } catch {
    /* audit is best-effort */
  }
}

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
  if (opCache.has(opRef)) {
    emitAudit({ event: 'secret.op_read', ref: opRef, cacheHit: true, ok: true });
    return opCache.get(opRef);
  }
  try {
    const secret = opRead(opRef);
    opCache.set(opRef, secret);
    emitAudit({ event: 'secret.op_read', ref: opRef, cacheHit: false, ok: true });
    return secret;
  } catch (err) {
    emitAudit({ event: 'secret.op_read', ref: opRef, cacheHit: false, ok: false, code: err?.code });
    throw err;
  }
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

function expandHomePath(file, home) {
  if (file === '~') return home;
  if (file.startsWith('~/')) return `${home}${file.slice(1)}`;
  return file;
}

function readOpEnvCatalogPath({ env, home }) {
  const pointerSources = [
    env?.CONSTRUCT_OP_ENV_FILE,
    readDotenvVar(path.join(configDir(home), 'config.env'), 'CONSTRUCT_OP_ENV_FILE'),
    readDotenvVar(path.join(home, '.construct', 'config.env'), 'CONSTRUCT_OP_ENV_FILE'),
  ].filter((value) => typeof value === 'string' && value.length > 0);
  for (const raw of pointerSources) {
    const file = expandHomePath(unquote(raw), home);
    try {
      if (fs.existsSync(file)) return file;
    } catch {
      continue;
    }
  }
  return null;
}

function readFromOpEnvCatalog(varName, { env, home }) {
  const catalogPath = readOpEnvCatalogPath({ env, home });
  if (!catalogPath) return null;
  return readDotenvVar(catalogPath, varName);
}

function rawCandidate(varName, { env, cwd, home }) {
  const direct = env?.[varName];
  if (typeof direct === 'string' && direct.length > 0) return { raw: direct, source: 'env' };

  // File tier matches loadConstructEnv: the project .env (closest to the work)
  // wins over the machine-wide XDG config.env, which wins over a generic ~/.env.
  const files = [
    { file: path.join(cwd, '.env'), source: 'project-env' },
    { file: path.join(configDir(home), 'config.env'), source: 'config-env' },
    { file: path.join(home, '.env'), source: 'home-env' },
  ];
  for (const { file, source } of files) {
    const value = readDotenvVar(file, varName);
    if (value) return { raw: value, source };
  }
  const alt = discoverAlternateRawForVar(varName, { home });
  if (alt) return { raw: alt, source: 'alt-store' };
  const fromOpCatalog = readFromOpEnvCatalog(varName, { env, home });
  if (fromOpCatalog) return { raw: fromOpCatalog, source: 'op-catalog' };
  const fromRc = readShellRcVar(varName, home);
  if (fromRc) return { raw: fromRc, source: 'shell-rc' };
  return null;
}

function resolveAndAudit(varName, raw, source, opts) {
  const isOpRef = Boolean(extractOpRef(raw));
  try {
    const value = materialize(raw, opts);
    emitAudit({ event: 'secret.resolve', varName, source, isOpRef, ok: true });
    return value;
  } catch (err) {
    emitAudit({ event: 'secret.resolve', varName, source, isOpRef, ok: false, code: err?.code });
    throw err;
  }
}

export function resolveSecret(varName, { env = process.env, cwd = process.cwd(), allowAmbient = true, opRead } = {}) {
  const direct = env?.[varName];
  if (typeof direct === 'string' && direct.length > 0) return resolveAndAudit(varName, direct, 'env', { opRead });
  if (!allowAmbient) {
    emitAudit({ event: 'secret.resolve', varName, source: null, isOpRef: false, ok: false });
    return null;
  }
  const home = os.homedir();
  const found = rawCandidate(varName, { env, cwd, home });
  if (!found) {
    emitAudit({ event: 'secret.resolve', varName, source: null, isOpRef: false, ok: false });
    return null;
  }
  return resolveAndAudit(varName, found.raw, found.source, { opRead });
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
  const found = rawCandidate(varName, { env, cwd, home });
  return Boolean(found && typeof found.raw === 'string' && found.raw.length > 0);
}

export function hasAnySecret(varNames, opts = {}) {
  return varNames.some((name) => hasSecret(name, opts));
}

export function __clearSecretCache() {
  opCache.clear();
}
