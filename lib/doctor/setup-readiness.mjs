/**
 * lib/doctor/setup-readiness.mjs — detect pre-setup HOME and collapse expected advisories.
 *
 * Before `construct install --footprint=user`, many doctor checks warn about
 * missing machine config (models, host adapters, PATH) that is normal on a fresh
 * HOME. Collapse those into one deferred summary while keeping real failures
 * and the primary install next step visible.
 */

import fs from 'node:fs';

import { configDir } from '../config/xdg.mjs';
import { getUserEnvPath } from '../env-config.mjs';

const PRE_SETUP_COLLAPSE_PATTERNS = [
  /^Models —/,
  /^construct command on PATH$/,
  /^construct command is this CLI$/,
  /^OpenCode config exists$/,
  /^Claude Code agents dir$/,
  /^Codex agents dir$/,
  /^Copilot prompts dir$/,
  /^Cursor MCP config$/,
  /^npm env: npm_config_devdir/,
  /^AUTO docs up to date$/,
  /^Skill structure \(/,
];

/**
 * @param {string} [homeDir]
 * @returns {boolean}
 */
export function isMachineSetupComplete(homeDir = process.env.HOME) {
  if (!homeDir) return false;
  return fs.existsSync(getUserEnvPath(homeDir)) || fs.existsSync(configDir(homeDir));
}

/**
 * @param {{ pass: boolean, optional?: boolean, label: string }} check
 */
export function isPreSetupCollapsibleAdvisory(check) {
  if (check.pass || !check.optional || check.alwaysShow) return false;
  return PRE_SETUP_COLLAPSE_PATTERNS.some((pattern) => pattern.test(check.label));
}

/**
 * @param {Array<{ pass: boolean, optional?: boolean, label: string, alwaysShow?: boolean }>} checks
 * @param {{ homeDir?: string }} [opts]
 * @returns {{ checks: typeof checks, collapsedCount: number }}
 */
export function prepareChecksForPreSetupReport(checks, { homeDir = process.env.HOME } = {}) {
  if (isMachineSetupComplete(homeDir)) {
    return { checks, collapsedCount: 0 };
  }

  const collapsible = [];
  const kept = [];

  for (const check of checks) {
    if (isPreSetupCollapsibleAdvisory(check)) collapsible.push(check);
    else kept.push(check);
  }

  if (collapsible.length === 0) {
    return { checks, collapsedCount: 0 };
  }

  const hasInstallHint = kept.some((check) => check.label.includes('User config not ready'));
  const summary = {
    pass: false,
    optional: true,
    label: hasInstallHint
      ? `Pre-setup: ${collapsible.length} machine-config check${collapsible.length === 1 ? '' : 's'} deferred — finish \`construct install --footprint=user\`, then re-run \`construct doctor\``
      : `Machine setup pending — run \`construct install --footprint=user\` (${collapsible.length} deferred check${collapsible.length === 1 ? '' : 's'} hidden until then)`,
  };

  const failures = kept.filter((check) => !check.pass && !check.optional);
  const installLine = kept.find((check) => check.label.includes('User config not ready'));
  const otherWarnings = kept.filter((check) => !check.pass && check.optional && check !== installLine);
  const alwaysShowWarnings = otherWarnings.filter((check) => check.alwaysShow);
  const passes = kept.filter((check) => check.pass);

  return {
    checks: [
      ...failures,
      ...(installLine ? [installLine] : []),
      summary,
      ...alwaysShowWarnings,
      ...otherWarnings.filter((check) => !check.alwaysShow),
      ...passes.filter((check) => check.alwaysShow),
      ...passes.filter((check) => !check.alwaysShow),
    ],
    collapsedCount: collapsible.length,
  };
}
