/**
 * lib/mcp/destructive-approval.mjs — out-of-band approval tokens for destructive MCP tools.
 *
 * storage_reset and delete_ingested_artifacts are reachable only through the model's
 * argument channel, so a confirm flag the model itself supplies cannot authorize
 * irreversible deletion. Tokens are issued out-of-band by an operator action (never the
 * model), persisted with 0600 under the user state dir — outside any project root, so a
 * root-contained file tool cannot read them — and consumed one-time. consumeApprovalToken
 * returns false unless a live, unexpired token for the scope matches, and never writes
 * when no token is supplied.
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { doctorRoot } from '../config/xdg.mjs';

const TOKEN_TTL_MS = 5 * 60 * 1000;

function storePath(env) {
  return path.join(doctorRoot(undefined, env), 'destructive-approvals.json');
}

function readStore(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStore(file, tokens) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(tokens), { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* non-posix filesystems */ }
}

export function issueApprovalToken(scope, { env = process.env, now = Date.now() } = {}) {
  if (typeof scope !== 'string' || !scope) throw new Error('scope required');
  const file = storePath(env);
  const token = randomBytes(24).toString('hex');
  const live = readStore(file).filter((t) => t.expiresAt > now);
  live.push({ token, scope, expiresAt: now + TOKEN_TTL_MS });
  writeStore(file, live);
  return token;
}

export function consumeApprovalToken(scope, token, { env = process.env, now = Date.now() } = {}) {
  if (typeof token !== 'string' || !token) return false;
  const file = storePath(env);
  const tokens = readStore(file);
  const idx = tokens.findIndex((t) => t.scope === scope && t.token === token && t.expiresAt > now);
  if (idx === -1) return false;
  tokens.splice(idx, 1);
  writeStore(file, tokens.filter((t) => t.expiresAt > now));
  return true;
}
