/**
 * lib/providers/creds.mjs — credential management for provider integrations.
 *
 * Reads and writes provider credentials stored in the user config.env (XDG config dir).
 * Each provider block is delimited by comment markers so the file can be
 * parsed without a full ini/dotenv library and can also be sourced by a shell.
 *
 * Block format (example for `github`):
 *
 *   # CONSTRUCT_CREDS_GITHUB
 *   CONSTRUCT_CREDS_GITHUB_KEY=ghp_xxx
 *   CONSTRUCT_CREDS_GITHUB_ACCOUNT=myorg
 *   CONSTRUCT_CREDS_GITHUB_ROTATED_AT=2026-05-27
 *   # END_CONSTRUCT_CREDS_GITHUB
 *
 * Security: `writeCreds` sets the file mode to 0600 after every write.
 * `checkCredsFileMode` reports whether the current mode is within policy.
 *
 * All functions are synchronous except those that need the filesystem and
 * are documented as async. Currently all ops are sync; the async signature
 * is reserved for future keychain-backend support.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configDir } from '../config/xdg.mjs';

const CONFIG_FILE = 'config.env';

function constructDir() {
  return configDir();
}

export function credsFilePath() {
  return path.join(constructDir(), CONFIG_FILE);
}

function providerKey(provider) {
  return provider.toUpperCase().replace(/-/g, '_');
}

function blockStart(key) {
  return `# CONSTRUCT_CREDS_${key}`;
}

function blockEnd(key) {
  return `# END_CONSTRUCT_CREDS_${key}`;
}

function readRaw() {
  const fp = credsFilePath();
  try {
    return fs.readFileSync(fp, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
}

function writeRaw(content) {
  const fp = credsFilePath();
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, { encoding: 'utf8', mode: 0o600 });

  // Re-apply mode after write; some platforms reset on open.
  fs.chmodSync(fp, 0o600);
}

function extractBlocks(raw) {
  const blocks = {};
  const lines = raw.split('\n');
  let current = null;
  let currentLines = [];

  for (const line of lines) {
    const startMatch = line.match(/^# CONSTRUCT_CREDS_([A-Z0-9_]+)$/);
    const endMatch = line.match(/^# END_CONSTRUCT_CREDS_([A-Z0-9_]+)$/);

    if (startMatch) {
      current = startMatch[1];
      currentLines = [line];
      continue;
    }
    if (endMatch && current === endMatch[1]) {
      currentLines.push(line);
      blocks[current] = currentLines.join('\n');
      current = null;
      currentLines = [];
      continue;
    }
    if (current) {
      currentLines.push(line);
    }
  }

  return blocks;
}

function parseBlock(blockText) {
  const result = {};
  for (const line of blockText.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    result[m[1]] = m[2];
  }
  return result;
}

function buildBlock(key, { account, apiKey, rotatedAt }) {
  const prefix = `CONSTRUCT_CREDS_${key}`;
  const lines = [blockStart(key)];
  if (apiKey !== undefined) lines.push(`${prefix}_KEY=${apiKey}`);
  if (account !== undefined) lines.push(`${prefix}_ACCOUNT=${account}`);
  if (rotatedAt !== undefined) lines.push(`${prefix}_ROTATED_AT=${rotatedAt}`);
  lines.push(blockEnd(key));
  return lines.join('\n');
}

function nextRotationDue(rotatedAtStr) {
  if (!rotatedAtStr) return null;
  const d = new Date(rotatedAtStr);
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + 90);
  return d.toISOString().slice(0, 10);
}

export function readCreds() {
  const raw = readRaw();
  const blocks = extractBlocks(raw);
  const result = {};

  for (const [upperKey, blockText] of Object.entries(blocks)) {
    const prefix = `CONSTRUCT_CREDS_${upperKey}`;
    const fields = parseBlock(blockText);
    const rotatedAt = fields[`${prefix}_ROTATED_AT`] || null;
    result[upperKey.toLowerCase().replace(/_/g, '-')] = {
      account: fields[`${prefix}_ACCOUNT`] || null,
      key: fields[`${prefix}_KEY`] || null,
      rotatedAt,
      nextRotationDue: nextRotationDue(rotatedAt),
    };
  }

  return result;
}

export function writeCreds(provider, { key, account } = {}) {
  const pKey = providerKey(provider);
  const raw = readRaw();
  const blocks = extractBlocks(raw);

  const existing = blocks[pKey] ? parseBlock(blocks[pKey]) : {};
  const prefix = `CONSTRUCT_CREDS_${pKey}`;

  const rotatedAt = key !== undefined
    ? new Date().toISOString().slice(0, 10)
    : (existing[`${prefix}_ROTATED_AT`] || null);

  const mergedAccount = account !== undefined ? account : (existing[`${prefix}_ACCOUNT`] || undefined);
  const mergedKey = key !== undefined ? key : (existing[`${prefix}_KEY`] || undefined);

  const newBlock = buildBlock(pKey, { account: mergedAccount, apiKey: mergedKey, rotatedAt });

  let newRaw;
  if (blocks[pKey]) {
    const startIdx = raw.indexOf(blockStart(pKey));
    const endIdx = raw.indexOf(blockEnd(pKey)) + blockEnd(pKey).length;
    newRaw = raw.slice(0, startIdx) + newBlock + raw.slice(endIdx);
  } else {
    const trimmed = raw.trimEnd();
    newRaw = trimmed ? `${trimmed}\n\n${newBlock}\n` : `${newBlock}\n`;
  }

  writeRaw(newRaw);
}

export function deleteCreds(provider) {
  const pKey = providerKey(provider);
  const raw = readRaw();
  const start = blockStart(pKey);
  const end = blockEnd(pKey);

  const startIdx = raw.indexOf(start);
  if (startIdx === -1) return;

  const endIdx = raw.indexOf(end, startIdx);
  if (endIdx === -1) return;

  const before = raw.slice(0, startIdx).trimEnd();
  const after = raw.slice(endIdx + end.length).trimStart();

  const newRaw = before && after
    ? `${before}\n\n${after}`
    : before
      ? `${before}\n`
      : after || '';

  writeRaw(newRaw);
}

export function checkCredsFileMode() {
  const fp = credsFilePath();
  try {
    const stat = fs.statSync(fp);
    const mode = stat.mode & 0o777;
    const modeStr = '0' + mode.toString(8);
    return { ok: mode <= 0o600, mode: modeStr };
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: true, mode: 'absent' };
    throw err;
  }
}

export function listCreds() {
  const all = readCreds();
  return Object.entries(all).map(([provider, data]) => ({
    provider,
    account: data.account,
    rotatedAt: data.rotatedAt,
    nextRotationDue: data.nextRotationDue,
  }));
}
