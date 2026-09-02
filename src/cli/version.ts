/**
 * cli/version.ts — the installed package version, read once from package.json.
 */

import { readFileSync } from 'node:fs';

let cached: string | null = null;

export function packageVersion(): string {
  if (cached) return cached;
  const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
  cached = (JSON.parse(raw) as { version: string }).version;
  return cached;
}
