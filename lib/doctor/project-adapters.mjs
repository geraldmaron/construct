/**
 * lib/doctor/project-adapters.mjs — doctor checks for project-scoped host adapters.
 *
 * When inside a Construct-managed project, verifies gitignored adapter artifacts
 * exist for installed hosts (.cursor/mcp.json, .vscode/mcp.json, construct.mdc).
 */

import { checkProjectParity } from '../parity.mjs';
import { detectHostCapabilities } from '../host-capabilities.mjs';

const HOST_REQUIRES = {
  cursor: ['cursor'],
  vscode: ['vscode'],
};

export function checkProjectAdaptersForDoctor({ rootDir, projectDir = rootDir }) {
  const parity = checkProjectParity({ rootDir, projectDir });
  if (parity.skipped) return { ok: true, label: 'Project adapters (not a Construct project)', warning: false };

  const installed = new Set(
    detectHostCapabilities()
      .filter((h) => h.availability === 'installed')
      .map((h) => h.host.toLowerCase().replace(/\s+/g, '')),
  );
  const installedIds = new Set();
  if (installed.has('claudecode') || installed.has('claude')) installedIds.add('claude');
  if (installed.has('vscode')) installedIds.add('vscode');
  if (installed.has('cursor')) installedIds.add('cursor');

  const failures = [];
  for (const surface of parity.surfaces) {
    if (surface.status === 'absent' && (surface.surface === 'cursor' || surface.surface === 'vscode')) {
      if (installedIds.has(surface.surface)) failures.push(surface);
    }
    if (surface.status === 'drift') failures.push(surface);
  }

  const ok = failures.length === 0;
  const label = ok
    ? `Project adapters (${parity.summary.filter((s) => s.includes(': ok')).length}/${parity.surfaces.length} ok)`
    : `Project adapters missing or stale — run \`npm run adapters\` (${failures.map((f) => f.surface).join(', ')})`;

  return { ok, label, warning: !ok, parity };
}
