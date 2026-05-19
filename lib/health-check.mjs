#!/usr/bin/env node
/**
 * lib/health-check.mjs — reusable prerequisite and health checks.
 *
 * Used by:
 * - `construct dev` (auto-checks before starting services)
 * - `construct doctor` (comprehensive system audit)
 * - `construct init` (pre-init validation)
 */

import { spawnSync } from 'node:child_process';
import { os } from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';

const isWindows = os.platform() === 'win32';

/**
 * Check if a command exists on PATH.
 * @param {string} command - Command name to check
 * @returns {boolean} - True if command exists
 */
export function commandExists(command) {
  const result = spawnSync(isWindows ? 'where' : 'zsh', 
    isWindows ? [command] : ['-lc', `command -v ${command}`], 
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
  return result.status === 0;
}

/**
 * Get version string from a command.
 * @param {string} command - Command name
 * @param {string[]} args - Arguments to get version
 * @returns {string|null} - Version string or null
 */
export function getVersion(command, args = ['--version']) {
  try {
    const result = spawnSync(command, args, { encoding: 'utf8' });
    if (result.status === 0) {
      return result.stdout.trim().split('\n')[0].trim();
    }
  } catch {
    // Ignore
  }
  return null;
}

/**
 * Run prerequisite checks for Construct.
 * @param {Object} options - Options
 * @param {boolean} options.interactive - Whether to prompt for fixes
 * @param {boolean} options.autoFix - Whether to auto-fix issues
 * @param {string} options.homeDir - Home directory path
 * @returns {Promise<{ok: boolean, missing: string[], warnings: string[]}>}
 */
export async function checkPrerequisites(options = {}) {
  const { interactive = false, autoFix = false, homeDir } = options;
  
  const checks = [];
  const missing = [];
  const warnings = [];
  
  // Check Docker
  const dockerVersion = getVersion('docker');
  const hasDocker = !!dockerVersion;
  checks.push({
    name: 'Docker',
    required: true,
    installed: hasDocker,
    version: dockerVersion,
    why: 'Required for Langfuse (trace observability) and managed Postgres',
    install: isWindows 
      ? 'https://docs.docker.com/desktop/install/windows-install/'
      : 'https://docs.docker.com/get-docker/',
  });
  
  // Check cm (Memory MCP server)
  const hasCm = commandExists('cm');
  const cmVersion = hasCm ? getVersion('cm', ['--version']) : null;
  checks.push({
    name: 'cm (Memory Server)',
    required: true,
    installed: hasCm,
    version: cmVersion,
    why: 'Required for cross-session agent memory and handoffs',
    install: 'brew install dicklesworthstone/tap/cm (macOS) or npm install -g @dicklesworthstone/cm',
  });
  
  // Check Node.js
  const nodeVersion = process.version;
  const nodeOk = parseInt(nodeVersion.slice(1)) >= 20;
  checks.push({
    name: 'Node.js',
    required: true,
    installed: nodeOk,
    version: nodeVersion,
    why: 'Required to run Construct CLI (v20+)',
    install: 'https://nodejs.org/',
  });
  
  // Check construct CLI on PATH (warning only)
  const constructOnPath = commandExists('construct');
  checks.push({
    name: 'construct CLI',
    required: false,
    installed: constructOnPath,
    version: constructOnPath ? getVersion('construct', ['version']) : null,
    why: 'Recommended for global access',
    install: 'npm install -g @geraldmaron/construct',
  });
  
  // Check user config
  const hasUserConfig = existsSync(path.join(homeDir || os.homedir(), '.construct', 'config.env')) ||
                        existsSync(path.join(homeDir || os.homedir(), '.construct'));
  checks.push({
    name: 'User config',
    required: false,
    installed: hasUserConfig,
    version: null,
    why: 'Created on first `construct init`',
    install: 'construct init',
  });
  
  // Print results if interactive
  if (interactive) {
    console.log('\n🔍 Checking prerequisites...\n');
    
    for (const check of checks) {
      const icon = check.installed ? '✓' : '✗';
      const status = check.installed 
        ? (check.version ? `v${check.version}` : 'installed')
        : 'MISSING';
      const indent = '  ';
      console.log(`${indent}${icon}  ${check.name.padEnd(25)} ${status}`);
      
      if (!check.installed) {
        console.log(`${indent}     → ${check.why}`);
        console.log(`${indent}     → Install: ${check.install}`);
        
        if (check.required) {
          missing.push(check.name);
        } else {
          warnings.push(check.name);
        }
      }
    }
    
    if (missing.length > 0) {
      console.log(`\n⚠️  Missing ${missing.length} required dependenc${missing.length === 1 ? 'y' : 'ies'}: ${missing.join(', ')}`);
      
      if (autoFix) {
        console.log('\n🔧 Auto-fix enabled — attempting to install missing dependencies...');
        return { ok: false, missing, warnings, autoFixRequested: true };
      }
      
      console.log('\n💡 Run `construct install --yes` to install missing dependencies automatically.');
    } else if (warnings.length > 0) {
      console.log(`\n⚠️  ${warnings.length} optional component${warnings.length === 1 ? '' : 's'} missing: ${warnings.join(', ')}`);
      console.log('   Construct will work but some features may be limited.');
    } else {
      console.log('\n✅ All prerequisites met!\n');
    }
  }
  
  return { ok: missing.length === 0, missing, warnings, checks };
}

/**
 * Quick health check for `construct dev` — silent unless there's a problem.
 * @param {Object} options - Options
 * @param {string} options.homeDir - Home directory
 * @returns {Promise<{ok: boolean, missing: string[]}>}
 */
export async function quickHealthCheck(options = {}) {
  const { homeDir } = options;
  
  const critical = [];
  
  // Silent Docker check
  if (!commandExists('docker')) {
    critical.push('Docker');
  }
  
  // Silent cm check
  if (!commandExists('cm')) {
    critical.push('cm (Memory MCP server)');
  }
  
  // Node.js check
  const nodeOk = parseInt(process.version.slice(1)) >= 20;
  if (!nodeOk) {
    critical.push(`Node.js ${process.version} (v20+ required)`);
  }
  
  return { ok: critical.length === 0, missing: critical };
}
