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
 * The process.env tier follows one precedence ladder shared with loadConstructEnv:
 * when file discovery is enabled (allowAmbient), the file tiers win over an ambient
 * shell export so a stale export cannot shadow a managed config value, with the same
 * carve-out that a materialized credential injected on the env beats a stored op://
 * reference (preferInjectedCredential). A hermetic caller sets allowAmbient:false to
 * suppress all file/rc discovery and use only the directly-injected env.
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
import { spawnSync, spawn } from 'node:child_process';
import { discoverAlternateRawForVar } from './credential-sources.mjs';
import { locateOpBinary } from './op-locate.mjs';
import { configDir } from '../config/xdg.mjs';
import { preferInjectedCredential } from '../env-config.mjs';

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

// A 1Password service account (OP_SERVICE_ACCOUNT_TOKEN) makes `op read`/`op run`
// non-interactive — no desktop app, no biometric, no `op signin` — which fits a
// multi-process / daemon / headless runtime and CI. It is opt-in: with no token the
// desktop app integration remains the default. The `op` CLI auto-detects the token
// from its process env; forwarding it from the caller's env (not just the ambient
// shell) lets Construct source it from the OS keychain at runtime rather than
// storing it in plaintext. Note: a service account cannot read the built-in
// Personal/Private vault and is rate-limited (1k reads/day on the Individual tier),
// so it pairs with resolve-once, not per-process op read.
// Docs: https://developer.1password.com/docs/service-accounts/

export function opServiceAccountToken(env = process.env) {
  const token = env?.OP_SERVICE_ACCOUNT_TOKEN;
  return typeof token === 'string' && token.trim() ? token.trim() : null;
}

function defaultOpWhoami() {
  const opPath = locateOpBinary();
  if (!opPath) return { installed: false, signedIn: false };
  const result = spawnSync(opPath, ['whoami'], { encoding: 'utf8', timeout: 5000 });
  if (result.error && result.error.code === 'ENOENT') return { installed: false, signedIn: false };
  return { installed: true, signedIn: result.status === 0 };
}

// Which 1Password auth mode `op` will use for a resolution, for doctor/diagnostics.
// A service-account token is non-interactive; otherwise `op` relies on the desktop
// app session, and `op whoami` reveals whether that session is live (a cold session
// is the usual cause of repeated biometric prompts). `whoami` is checked, not `read`,
// so it never prompts. Injectable for tests.

export function describeOpAuthMode(env = process.env, { whoami = defaultOpWhoami } = {}) {
  if (opServiceAccountToken(env)) {
    return { mode: 'service-account', signedIn: true, detail: 'OP_SERVICE_ACCOUNT_TOKEN set — op read/op run authenticate non-interactively.' };
  }
  const state = whoami();
  if (!state.installed) {
    return { mode: 'op-absent', signedIn: false, detail: '1Password CLI (op) not installed — set keys directly or install op.' };
  }
  if (state.signedIn) {
    return { mode: 'desktop-session', signedIn: true, detail: 'op is signed in via the desktop app session.' };
  }
  return {
    mode: 'desktop-session',
    signedIn: false,
    detail: 'op is not signed in — enable Settings → Developer → Integrate with 1Password CLI, or set OP_SERVICE_ACCOUNT_TOKEN for non-interactive auth.',
  };
}

function opReadChildEnv(env) {
  const token = opServiceAccountToken(env);
  return token ? { ...process.env, OP_SERVICE_ACCOUNT_TOKEN: token } : process.env;
}

// Map an `op read` outcome — from the sync spawnSync reader or the async spawn reader —
// to the resolved secret or a classified SecretResolutionError. Both readers funnel
// through here so their error taxonomy (OP_NOT_INSTALLED / OP_NOT_SIGNED_IN /
// OP_READ_FAILED / OP_EMPTY) cannot drift apart.

function interpretOpReadResult(opRef, { enoent, status, stdout, stderr }) {
  if (enoent) {
    throw new SecretResolutionError('1Password CLI not found — install `op` or set the key directly.', 'OP_NOT_INSTALLED');
  }
  if (status !== 0) {
    const err = String(stderr || '').toLowerCase();
    if (/sign in|signin|session|not currently|authenticate|authorization|no account/.test(err)) {
      throw new SecretResolutionError('1Password CLI is not signed in — enable the desktop app CLI integration (Settings → Developer) and unlock, or set OP_SERVICE_ACCOUNT_TOKEN for non-interactive access.', 'OP_NOT_SIGNED_IN');
    }
    throw new SecretResolutionError(`op read failed for ${opRef}: ${String(stderr || '').trim().slice(0, 160)}`, 'OP_READ_FAILED');
  }
  const secret = String(stdout || '').trim();
  if (!secret) throw new SecretResolutionError(`op read returned an empty value for ${opRef}`, 'OP_EMPTY');
  return secret;
}

function defaultOpRead(opRef, { env = process.env } = {}) {
  const opPath = locateOpBinary();
  if (!opPath) {
    throw new SecretResolutionError('1Password CLI not found — install `op` or set the key directly.', 'OP_NOT_INSTALLED');
  }
  const result = spawnSync(opPath, ['read', opRef], { encoding: 'utf8', timeout: OP_READ_TIMEOUT_MS, env: opReadChildEnv(env) });
  return interpretOpReadResult(opRef, {
    enoent: Boolean(result.error && result.error.code === 'ENOENT'),
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  });
}

// The MCP CallTool path resolves provider keys inside the single-threaded server, so
// a spawnSync `op read` freezes the event loop — and its own Promise.race timeout
// guard — for up to OP_READ_TIMEOUT_MS on the first op:// touch. This async reader
// uses spawn so the loop keeps turning, killing the child at the same timeout and
// mapping the outcome through the same interpretOpReadResult.

function defaultOpReadAsync(opRef, { env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const opPath = locateOpBinary();
    if (!opPath) {
      reject(new SecretResolutionError('1Password CLI not found — install `op` or set the key directly.', 'OP_NOT_INSTALLED'));
      return;
    }
    const child = spawn(opPath, ['read', opRef], { env: opReadChildEnv(env) });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };
    timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already exited */ }
      finish(() => reject(new SecretResolutionError(`op read failed for ${opRef}: timed out after ${OP_READ_TIMEOUT_MS}ms`, 'OP_READ_FAILED')));
    }, OP_READ_TIMEOUT_MS);
    child.stdout?.on('data', (d) => { stdout += String(d); });
    child.stderr?.on('data', (d) => { stderr += String(d); });
    child.on('error', (opErr) => finish(() => {
      if (opErr && opErr.code === 'ENOENT') {
        reject(new SecretResolutionError('1Password CLI not found — install `op` or set the key directly.', 'OP_NOT_INSTALLED'));
        return;
      }
      reject(opErr);
    }));
    child.on('close', (code) => finish(() => {
      try { resolve(interpretOpReadResult(opRef, { enoent: false, status: code, stdout, stderr })); }
      catch (err) { reject(err); }
    }));
  });
}

export function resolveOpRef(opRef, { opRead = defaultOpRead, env = process.env } = {}) {
  if (opCache.has(opRef)) {
    emitAudit({ event: 'secret.op_read', ref: opRef, cacheHit: true, ok: true });
    return opCache.get(opRef);
  }
  try {
    const secret = opRead(opRef, { env });
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
  // Pure file/store discovery: the ambient env tier is ranked by the callers
  // (resolveSecret / hasSecret) so one precedence ladder governs env-vs-file.
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
  const hasDirect = typeof direct === 'string' && direct.length > 0;

  // Hermetic mode: only the directly-injected env is consulted, no file/rc discovery,
  // so a developer key never bleeds into an isolated run.
  if (!allowAmbient) {
    if (hasDirect) return resolveAndAudit(varName, direct, 'env', { opRead, env });
    emitAudit({ event: 'secret.resolve', varName, source: null, isOpRef: false, ok: false });
    return null;
  }

  const home = os.homedir();
  const found = rawCandidate(varName, { env, cwd, home });

  // Precedence parity with loadConstructEnv: the file tiers win over an ambient shell
  // export, except a materialized credential injected on the env beats a stored op://
  // reference so a single `op run` auth suffices.
  if (found) {
    if (hasDirect && preferInjectedCredential(direct, found.raw)) {
      return resolveAndAudit(varName, direct, 'env', { opRead, env });
    }
    return resolveAndAudit(varName, found.raw, found.source, { opRead, env });
  }

  if (hasDirect) return resolveAndAudit(varName, direct, 'env', { opRead, env });
  emitAudit({ event: 'secret.resolve', varName, source: null, isOpRef: false, ok: false });
  return null;
}

export function resolveFirstSecret(varNames, opts = {}) {
  for (const name of varNames) {
    const value = resolveSecret(name, opts);
    if (value) return value;
  }
  return null;
}

// Async twins for the MCP CallTool hot path: file/rc discovery stays synchronous
// (small local fs reads, not the blocking step), but op:// materialization uses
// defaultOpReadAsync (spawn) instead of spawnSync so the single-threaded MCP server's
// event loop keeps turning during a slow `op read`. The shared opCache means a value
// resolved by either the sync or async path serves both, so a warm ref never re-spawns.

export async function resolveOpRefAsync(opRef, { opRead = defaultOpReadAsync, env = process.env } = {}) {
  if (opCache.has(opRef)) {
    emitAudit({ event: 'secret.op_read', ref: opRef, cacheHit: true, ok: true });
    return opCache.get(opRef);
  }
  try {
    const secret = await opRead(opRef, { env });
    opCache.set(opRef, secret);
    emitAudit({ event: 'secret.op_read', ref: opRef, cacheHit: false, ok: true });
    return secret;
  } catch (err) {
    emitAudit({ event: 'secret.op_read', ref: opRef, cacheHit: false, ok: false, code: err?.code });
    throw err;
  }
}

async function materializeAsync(rawValue, opts) {
  const ref = extractOpRef(rawValue);
  return ref ? resolveOpRefAsync(ref, opts) : unquote(rawValue);
}

async function resolveAndAuditAsync(varName, raw, source, opts) {
  const isOpRef = Boolean(extractOpRef(raw));
  try {
    const value = await materializeAsync(raw, opts);
    emitAudit({ event: 'secret.resolve', varName, source, isOpRef, ok: true });
    return value;
  } catch (err) {
    emitAudit({ event: 'secret.resolve', varName, source, isOpRef, ok: false, code: err?.code });
    throw err;
  }
}

export async function resolveSecretAsync(varName, { env = process.env, cwd = process.cwd(), allowAmbient = true, opRead } = {}) {
  const direct = env?.[varName];
  const hasDirect = typeof direct === 'string' && direct.length > 0;

  if (!allowAmbient) {
    if (hasDirect) return resolveAndAuditAsync(varName, direct, 'env', { opRead, env });
    emitAudit({ event: 'secret.resolve', varName, source: null, isOpRef: false, ok: false });
    return null;
  }

  const home = os.homedir();
  const found = rawCandidate(varName, { env, cwd, home });

  if (found) {
    if (hasDirect && preferInjectedCredential(direct, found.raw)) {
      return resolveAndAuditAsync(varName, direct, 'env', { opRead, env });
    }
    return resolveAndAuditAsync(varName, found.raw, found.source, { opRead, env });
  }

  if (hasDirect) return resolveAndAuditAsync(varName, direct, 'env', { opRead, env });
  emitAudit({ event: 'secret.resolve', varName, source: null, isOpRef: false, ok: false });
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
