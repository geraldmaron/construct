/**
 * lib/doctor/host-config.mjs — user-level host config checks for doctor.
 *
 * Emits warnings only when a host binary/config signal says the editor is
 * installed but Construct's adapter files are missing. Absent hosts are
 * omitted so fresh installs are not flooded with ⚠ for tools they do not use.
 */

import fs from 'node:fs';
import path from 'node:path';

import { detectHostCapabilities } from '../host-capabilities.mjs';
import { isMachineSetupComplete } from './setup-readiness.mjs';

/**
 * @param {string} homeDir
 * @param {{ hosts?: ReturnType<typeof detectHostCapabilities> }} [opts]
 * @returns {Array<{ pass: boolean, optional: boolean, label: string }>}
 */
export function buildHostConfigChecks(homeDir, { hosts = detectHostCapabilities() } = {}) {
  if (!isMachineSetupComplete(homeDir)) return [];

  const checks = [];
  const installed = new Set(
    hosts.filter((h) => h.availability === 'installed').map((h) => h.host),
  );

  if (installed.has('OpenCode')) {
    checks.push({
      pass: fs.existsSync(path.join(homeDir, '.config', 'opencode', 'opencode.json')),
      optional: true,
      label: 'OpenCode config exists',
    });
  }

  if (installed.has('Claude Code')) {
    checks.push({
      pass: fs.existsSync(path.join(homeDir, '.claude', 'agents')),
      optional: true,
      label: 'Claude Code agents dir',
    });
  }

  if (installed.has('Codex')) {
    checks.push({
      pass: fs.existsSync(path.join(homeDir, '.codex', 'agents')),
      optional: true,
      label: 'Codex agents dir',
    });
  }

  if (installed.has('Copilot')) {
    checks.push({
      pass: fs.existsSync(path.join(homeDir, '.github', 'prompts')),
      optional: true,
      label: 'Copilot prompts dir',
    });
  }

  const cursorHomeDir = path.join(homeDir, '.cursor');
  if (fs.existsSync(cursorHomeDir)) {
    checks.push({
      pass: fs.existsSync(path.join(cursorHomeDir, 'mcp.json')),
      optional: true,
      label: 'Cursor MCP config',
    });
  }

  return checks;
}
