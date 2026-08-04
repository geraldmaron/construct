/**
 * kernel/capabilities/secretfile.ts — where the kernel's token-signing secret
 * lives at rest, and nothing else about it.
 *
 * tokens.ts takes the secret as an injected string and deliberately knows
 * nothing about storage. This module is the storage: one file, created 0600,
 * holding 32 random bytes as hex. The path is injected — the caller derives it
 * from its own resolved Paths — so this module reads no environment, keeping
 * the kernel/paths.ts monopoly intact.
 *
 * Creation is exclusive (`wx`) rather than check-then-write: two processes
 * racing to first use must converge on ONE secret, or the loser mints tokens
 * the winner's verifier rejects as forgeries. Losing the race falls through to
 * reading the winner's file.
 *
 * `loadSecret` (read-only) exists separately because the two callers are not
 * peers: the coordinator is the minter and may establish the secret; a serving
 * process that merely verifies must never invent one, since a fresh secret on
 * the verifying side would silently deny every honestly-minted token as a
 * forgery — a misconfiguration that should read as "no secret here", not as an
 * endless stream of bad signatures.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';

/** Read the secret, or null when none has been established at this path. */
export function loadSecret(file: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const secret = raw.trim();
  return secret.length > 0 ? secret : null;
}

/** Read the secret, establishing it first if this is the first use. */
export function loadOrCreateSecret(file: string): string {
  const existing = loadSecret(file);
  if (existing !== null) return existing;

  const fresh = randomBytes(32).toString('hex');
  mkdirSync(dirname(file), { recursive: true });
  try {
    writeFileSync(file, `${fresh}\n`, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    // Lost the creation race; the winner's secret is the secret.
    const winner = loadSecret(file);
    if (winner === null) throw new Error(`capability secret at ${file} exists but is empty`);
    return winner;
  }
  return fresh;
}
