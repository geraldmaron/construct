/**
 * lib/doctor/host-hook-coverage.mjs — doctor check for Claude-only Layer-1
 * hooks and fail-closed compensating controls on other hosts.
 *
 * Surfaces an explicit, non-fake posture: Construct wires agent lifecycle hooks
 * only for Claude Code. When Cursor/VS Code/Codex/OpenCode adapters are present,
 * git hooks (Layer 2) must be wired so policy still fails closed at commit time.
 */

import fs from 'node:fs';
import path from 'node:path';
import { checkProjectGitHooks } from './git-hooks.mjs';
import {
  detectProjectHostAdapters,
  constructShippedCursorHooksJson,
  COMPENSATING_CONTROLS,
} from '../hooks/_lib/host-coverage.mjs';

/**
 * @param {string} projectDir
 * @param {{
 *   checkGitHooks?: typeof checkProjectGitHooks,
 *   inCI?: boolean,
 * }} [opts]
 * @returns {{
 *   run: boolean,
 *   pass: boolean,
 *   label: string,
 *   hosts: string[],
 *   checks: { id: string, pass: boolean, label: string, informational?: boolean }[],
 * }}
 */
export function checkHostHookCoverage(projectDir, {
  checkGitHooks = checkProjectGitHooks,
  inCI = false,
} = {}) {
  const hosts = detectProjectHostAdapters(projectDir);
  const nonClaude = hosts.filter((h) => h !== 'claude');
  const checks = [];

  checks.push({
    id: 'layer1-claude-only',
    pass: true,
    informational: true,
    label: 'Agent lifecycle hooks: Construct wires Claude Code only (Cursor/others use compensating gates)',
  });

  if (hosts.includes('cursor') || fs.existsSync(path.join(projectDir, '.cursor'))) {
    const hasCursorHooksJson = constructShippedCursorHooksJson(projectDir);
    checks.push({
      id: 'no-fake-cursor-hooks',
      pass: true,
      informational: true,
      label: hasCursorHooksJson
        ? '`.cursor/hooks.json` present — Construct does not own or claim parity for it; Layer-2 git/CI gates remain the fail-closed path'
        : 'No `.cursor/hooks.json` (Construct does not ship Cursor hook parity)',
    });
  }

  const git = checkGitHooks(projectDir, { inCI });
  if (nonClaude.length > 0 && git.run) {
    checks.push({
      id: 'compensating-git-hooks',
      pass: git.pass,
      label: git.pass
        ? `Compensating Layer-2 git hooks wired for non-Claude hosts (${nonClaude.join(', ')})`
        : `Non-Claude hosts (${nonClaude.join(', ')}) present but ${git.label}`,
    });
  } else if (nonClaude.length > 0 && !git.run && !inCI) {
    const beadsPreCommit = path.join(projectDir, '.beads', 'hooks', 'pre-commit');
    if (!fs.existsSync(beadsPreCommit)) {
      checks.push({
        id: 'compensating-git-hooks',
        pass: false,
        label: `Non-Claude hosts (${nonClaude.join(', ')}) present but .beads/hooks/pre-commit missing — Layer-2 compensating gate unavailable`,
      });
    }
  }

  const failClosed = COMPENSATING_CONTROLS.filter((c) => c.failClosed).map((c) => c.id);
  checks.push({
    id: 'compensating-catalog',
    pass: true,
    informational: true,
    label: `Fail-closed compensators when Layer-1 absent: ${failClosed.join(', ')}`,
  });

  const blocking = checks.filter((c) => !c.informational && !c.pass);
  const label = blocking.length === 0
    ? (nonClaude.length
      ? `Host hook coverage: Claude-only Layer-1; ${nonClaude.length} other host(s) rely on compensating gates`
      : 'Host hook coverage: Claude-only Layer-1 (no non-Claude adapters detected)')
    : blocking.map((c) => c.label).join('; ');

  return {
    run: true,
    pass: blocking.length === 0,
    label,
    hosts,
    checks,
  };
}
