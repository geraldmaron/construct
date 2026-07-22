#!/usr/bin/env node
/**
 * scripts/check-supply-chain-exceptions.mjs — enforce expiring OSV/license exceptions.
 *
 * Mirrors the LEGACY_EXEMPT_SHAS pattern in scripts/lint-commits-pr.mjs: every
 * exception carries an explicit expiration date and fails the gate once expired.
 * Run locally and in CI before OSV/dependency-review jobs consume the file.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXCEPTIONS_PATH = path.join(REPO_ROOT, '.github', 'supply-chain-exceptions.json');

function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function evaluateSupplyChainExceptions({ now = new Date(), filePath = EXCEPTIONS_PATH } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    return { ok: false, errors: [`failed to read ${filePath}: ${err.message}`], expired: [], active: [] };
  }

  const entries = Array.isArray(parsed?.exceptions) ? parsed.exceptions : [];
  const errors = [];
  const expired = [];
  const active = [];

  for (const [index, entry] of entries.entries()) {
    const label = entry?.id || `entry[${index}]`;
    if (!entry?.reason) errors.push(`${label}: missing reason`);
    const expiresAt = parseDate(entry?.expires);
    if (!expiresAt) {
      errors.push(`${label}: missing or invalid expires (expected YYYY-MM-DD)`);
      continue;
    }
    if (now.getTime() > expiresAt.getTime()) {
      expired.push({ ...entry, label });
    } else {
      active.push({ ...entry, label });
    }
  }

  if (expired.length) {
    for (const entry of expired) {
      errors.push(`${entry.label}: expired on ${entry.expires} (${entry.reason || 'no reason recorded'})`);
    }
  }

  return { ok: errors.length === 0, errors, expired, active };
}

function main() {
  const result = evaluateSupplyChainExceptions();
  if (!result.ok) {
    for (const err of result.errors) process.stderr.write(`supply-chain-exceptions: ${err}\n`);
    process.exit(1);
  }
  process.stdout.write(`supply-chain-exceptions: ${result.active.length} active exception(s)\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
