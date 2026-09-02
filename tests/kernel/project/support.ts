/**
 * tests/kernel/project/support.ts — a throwaway project root per test.
 */

import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function tmpProject(): { readonly root: string; cleanup(): void } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'construct-project-')));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export const AT = '2026-09-02T12:00:00.000Z';
