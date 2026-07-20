/**
 * lib/init/scaffold-docs-pack.mjs — explicit docs-pack scaffolding for non-init flows.
 *
 * Delegates to lib/init-docs.mjs so lane templates, deferral heuristics, and
 * docs/README indexing stay aligned with construct init. Callers must opt in
 * with a validated preset name; this module never picks a default pack.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { packageRoot } from '../roots.mjs';
import { DOC_PACK_ORDER, DOC_PRESETS } from './doc-lanes.mjs';

/**
 * @param {{ cwd: string, docsPreset: string, force?: boolean }} opts
 * @returns {{ ok: true, stdout: string, createdCount: number|null, skippedCount: number|null } | { ok: false, message: string }}
 */
export function applyDocsPack({ cwd, docsPreset, force = false }) {
  const preset = String(docsPreset || '').toLowerCase();
  if (!DOC_PRESETS[preset]) {
    return {
      ok: false,
      message: `Unknown docs pack: ${docsPreset}. Available: ${DOC_PACK_ORDER.join(', ')}`,
    };
  }

  const script = path.join(packageRoot, 'lib', 'init-docs.mjs');
  const argv = [script, '--yes', `--docs-preset=${preset}`];
  if (force) argv.push('--force');

  const result = spawnSync(process.execPath, argv, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    return {
      ok: false,
      message: detail || `Docs pack scaffolding failed (exit ${result.status ?? 'unknown'})`,
    };
  }

  const createdMatch = result.stdout.match(/(\d+) created, (\d+) skipped/);
  return {
    ok: true,
    stdout: result.stdout,
    createdCount: createdMatch ? Number(createdMatch[1]) : null,
    skippedCount: createdMatch ? Number(createdMatch[2]) : null,
  };
}
