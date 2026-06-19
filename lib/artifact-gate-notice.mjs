/**
 * lib/artifact-gate-notice.mjs — Shared PostToolUse artifact structure/visual check.
 *
 * Returns violations for typed docs under docs/** and .cx/research/** without
 * applying TTY/CI suppression (callers decide whether to emit).
 */

import path from 'node:path';
import { inferArtifactTypeFromPath, isArtifactGatePath } from './artifact-type-from-path.mjs';
import { lintDocStructure, lintDocVisuals } from './templates/visual-requirements.mjs';

export function checkArtifactGateNotice(filePath, { cwd = process.cwd() } = {}) {
  const rel = filePath.startsWith(cwd)
    ? filePath.slice(cwd.length).replace(/^\/+/, '')
    : filePath;
  if (!isArtifactGatePath(rel)) return null;

  const type = inferArtifactTypeFromPath(filePath, { rootDir: cwd });
  if (!type) return null;

  const errors = [
    ...lintDocStructure(filePath, type),
    ...lintDocVisuals(filePath, type),
  ];
  if (errors.length === 0) return null;

  return { type, rel, errors };
}

export function formatArtifactGateNotice({ type, rel, errors }) {
  const lines = [
    `\nartifact-release-gate (${type}): ${errors.length} structure/visual issue(s). `
    + 'Fix before calling the artifact done; full gate: '
    + `\`construct artifact validate ${rel} --type=${type}\`\n`,
  ];
  for (const e of errors) lines.push(`  - ${e}\n`);
  return lines.join('');
}
