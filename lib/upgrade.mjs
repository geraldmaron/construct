/**
 * upgrade.mjs — npm upgrade flow for Construct end users.
 *
 * Fetches latest version from npm, upgrades global install, then re-syncs
 * all editor adapters and runs health checks.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const PACKAGE_NAME = '@geraldmaron/construct';

function getCurrentVersion() {
  const pkgPath = path.join(ROOT_DIR, 'package.json');
  if (!fs.existsSync(pkgPath)) return 'unknown';
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function getLatestVersion() {
  const result = spawnSync('npm', ['view', PACKAGE_NAME, 'version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function compareVersions(current, latest) {
  if (current === 'unknown' || !latest) return null;
  
  const parse = (v) => v.split('.').map((n) => parseInt(n, 10) || 0);
  const [cMajor, cMinor, cPatch] = parse(current);
  const [lMajor, lMinor, lPatch] = parse(latest);
  
  if (lMajor > cMajor) return 'major';
  if (lMajor < cMajor) return 'older';
  if (lMinor > cMinor) return 'minor';
  if (lMinor < cMinor) return 'older';
  if (lPatch > cPatch) return 'patch';
  if (lPatch < cPatch) return 'older';
  return 'current';
}

export function runUpgrade({ cwd = process.cwd(), env = process.env, stdout = process.stdout, yes = false } = {}) {
  const currentVersion = getCurrentVersion();
  
  stdout.write('Construct Upgrade Check\n');
  stdout.write('═══════════════════════\n\n');
  stdout.write(`Current version: ${currentVersion}\n`);
  
  const latestVersion = getLatestVersion();
  if (!latestVersion) {
    stdout.write('\n');
    stdout.write('Unable to fetch latest version from npm.\n');
    stdout.write('Check your network connection and try again.\n');
    return { success: false, reason: 'npm_view_failed' };
  }
  
  stdout.write(`Latest version:  ${latestVersion}\n`);
  
  const upgradeType = compareVersions(currentVersion, latestVersion);
  if (!upgradeType) {
    stdout.write('\nUnable to compare versions.\n');
    return { success: false, reason: 'version_compare_failed' };
  }
  
  if (upgradeType === 'current' || upgradeType === 'older') {
    stdout.write('\n');
    if (upgradeType === 'current') {
      stdout.write('✓ You are already on the latest version.\n');
    } else {
      stdout.write('⚠ Your version appears to be ahead of npm (development build).\n');
    }
    return { success: true, upgraded: false, reason: upgradeType };
  }
  
  stdout.write('\n');
  stdout.write(`Upgrade available: ${currentVersion} → ${latestVersion} (${upgradeType})\n`);
  stdout.write('\n');
  
  if (!yes) {
    stdout.write('Proceed with upgrade? [y/N] ');
    const response = fs.readFileSync(0, 'utf8').trim().toLowerCase();
    if (!['y', 'yes', 'yeah', 'sure', 'ok', 'go', 'proceed'].includes(response)) {
      stdout.write('Upgrade cancelled.\n');
      return { success: true, upgraded: false, reason: 'user_cancelled' };
    }
  }
  
  stdout.write('Upgrading...\n\n');
  
  const steps = [
    {
      label: 'Fetching latest from npm',
      command: 'npm',
      args: ['install', '-g', PACKAGE_NAME],
    },
    {
      label: 'Regenerating host adapters',
      command: 'construct',
      args: ['sync', '--no-docs'],
    },
    {
      label: 'Running health checks',
      command: 'construct',
      args: ['doctor'],
    },
  ];
  
  for (const step of steps) {
    stdout.write(`→ ${step.label}\n`);
    const result = spawnSync(step.command, step.args, {
      cwd,
      env,
      stdio: 'inherit',
    });
    
    if (result.error) {
      stdout.write(`\n✗ ${step.label} failed: ${result.error.message}\n`);
      return { success: false, reason: 'step_failed', step: step.label };
    }
    
    if (result.status !== 0) {
      stdout.write(`\n✗ ${step.label} failed with exit code ${result.status}\n`);
      return { success: false, reason: 'step_failed', step: step.label };
    }
  }
  
  stdout.write('\n');
  stdout.write(`✓ Upgraded to ${latestVersion}\n`);
  return { success: true, upgraded: true, from: currentVersion, to: latestVersion };
}
