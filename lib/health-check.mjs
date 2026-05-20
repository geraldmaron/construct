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
import os from 'node:os';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

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
    why: 'Required for telemetry backend (trace observability) and managed Postgres',
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
 * Get a value from shell env by checking common sources.
 * Looks in process.env → project .env → ~/.env → ~/.construct/config.env
 * → shell rc files for op:// refs (resolved via 'op read').
 */
function getEnvFromShell(varName, homeDir) {
  if (process.env[varName]) return process.env[varName];

  const projectEnv = path.join(process.cwd(), '.env');
  if (existsSync(projectEnv)) {
    try {
      const content = readFileSync(projectEnv, 'utf8');
      const m = content.match(new RegExp(`^${varName}=["']?(.+?)["']?$`, 'm'));
      if (m) return m[1].trim();
    } catch { /* skip */ }
  }

  const homeEnv = path.join(homeDir, '.env');
  if (existsSync(homeEnv)) {
    try {
      const content = readFileSync(homeEnv, 'utf8');
      const m = content.match(new RegExp(`^${varName}=["']?(.+?)["']?$`, 'm'));
      if (m) return m[1].trim();
    } catch { /* skip */ }
  }

  const cfgPath = path.join(homeDir, '.construct', 'config.env');
  if (existsSync(cfgPath)) {
    try {
      const content = readFileSync(cfgPath, 'utf8');
      const m = content.match(new RegExp(`^${varName}=(.+)$`, 'm'));
      if (m) return m[1].trim();
    } catch { /* skip */ }
  }

  const shellFiles = [
    path.join(homeDir, '.zshrc'),
    path.join(homeDir, '.bashrc'),
    path.join(homeDir, '.bash_profile'),
    path.join(homeDir, '.profile'),
  ];
  for (const rcPath of shellFiles) {
    if (!existsSync(rcPath)) continue;
    try {
      const content = readFileSync(rcPath, 'utf8');
      const re = new RegExp(`export\\s+${varName}=["']?\\$\\(op read '([^']+)'\\)["']?`, 'm');
      const m = content.match(re);
      if (m) {
        const opRef = m[1];
        try {
          const result = spawnSync('op', ['read', opRef], {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 5000,
          });
          if (result.status === 0) return result.stdout.trim();
        } catch { /* op read failed */ }
      }
    } catch { /* skip unreadable files */ }
  }

  // If we found an op:// reference but couldn't read it, log the error
  // for diagnostic purposes when DEBUG is on.
  if (process.env.CONSTRUCT_DEBUG_CREDENTIALS === '1') {
    for (const rcPath of shellFiles) {
      if (!existsSync(rcPath)) continue;
      try {
        const content = readFileSync(rcPath, 'utf8');
        const re = new RegExp(`export\\s+${varName}=["']?\\$\\(op read '([^']+)'\\)["']?`, 'm');
        const m = content.match(re);
        if (m) {
          try {
            const result = spawnSync('op', ['read', m[1]], { encoding: 'utf8', timeout: 5000 });
            if (result.status !== 0) {
              const errMsg = (result.stderr || '').trim().slice(0, 200);
              process.stderr.write(`[credentials] ${varName}: op read '${m[1]}' failed: ${errMsg}\n`);
            }
          } catch (e) {
            process.stderr.write(`[credentials] ${varName}: op CLI error: ${e.message}\n`);
          }
        }
      } catch { /* skip */ }
    }
  }

  return null;
}

/**
 * Known credential env vars and their 1Password lookup patterns.
 */
const CREDENTIAL_VARS = [
  'OPENROUTER_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'SLACK_BOT_TOKEN',
  'SLACK_USER_TOKEN',
  'JIRA_API_TOKEN',
  'CONFLUENCE_API_TOKEN',
  'SALESFORCE_ACCESS_TOKEN',
  'OPENCODE_API_KEY',
  'HUGGINGFACE_API_KEY',
  'GROQ_API_KEY',
  'MISTRAL_API_KEY',
  'REPLICATE_API_KEY',
  'COHERE_API_KEY',
  'AI21_API_KEY',
  'TOGETHER_API_KEY',
  'DEEPSEEK_API_KEY',
  'PERPLEXITY_API_KEY',
  'CLAUDE_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_ENDPOINT',
  'CONSTRUCT_TELEMETRY_PUBLIC_KEY',
  'CONSTRUCT_TELEMETRY_SECRET_KEY',
  'CONSTRUCT_TELEMETRY_URL',
];

/**
 * Resolve all known credentials from env, .env files, and 1Password.
 * @param {Object} options
 * @param {string} options.homeDir
 * @param {boolean} options.writeConfig - Write resolved keys to config.env (default: true)
 * @returns {Promise<Record<string, string>>} resolved key-value pairs
 */
export async function resolveCredentials(options = {}) {
  const { homeDir = os.homedir(), writeConfig = true } = options;
  const resolved = {};

  for (const varName of CREDENTIAL_VARS) {
    const value = getEnvFromShell(varName, homeDir);
    if (value) resolved[varName] = value;
  }

  // Write resolved keys to config.env so subprocesses and the dashboard find them
  if (writeConfig && Object.keys(resolved).length > 0) {
    try {
      const { writeEnvValues, getUserEnvPath } = await import('./env-config.mjs');
      writeEnvValues(getUserEnvPath(homeDir), resolved);
    } catch { /* best effort */ }
  }

  return resolved;
}

/**
 * Detect existing credentials and tools on the system.
 * @param {Object} options
 * @param {string} options.homeDir
 * @returns {object} detected credentials
 */
export function detectCredentials(options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const found = {};

  // GitHub CLI auth
  const ghAuth = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  found.github_cli = ghAuth.status === 0;

  // GitHub Copilot (check VS Code extension state)
  const copilotDir = path.join(homeDir, '.vscode', 'extensions');
  const copilotExists = existsSync(copilotDir) && existsSync(path.join(homeDir, '.config', 'Code', 'User', 'globalStorage', 'github.copilot'));
  found.copilot = copilotExists || commandExists('copilot');

  // OpenRouter API key
  found.openrouter_key = !!getEnvFromShell('OPENROUTER_API_KEY', homeDir);

  // Anthropic API key
  found.anthropic_key = !!getEnvFromShell('ANTHROPIC_API_KEY', homeDir);

  // OpenAI API key
  found.openai_key = !!getEnvFromShell('OPENAI_API_KEY', homeDir);

  // GitHub token
  found.github_token = !!getEnvFromShell('GITHUB_TOKEN', homeDir) || !!getEnvFromShell('GH_TOKEN', homeDir);

  // VS Code installed
  found.vscode = commandExists('code');

  // Claude Code config
  found.claude_code = existsSync(path.join(homeDir, '.claude', 'settings.json'));

  // OpenCode config
  found.opencode = existsSync(path.join(homeDir, '.config', 'opencode', 'opencode.json')) ||
                    existsSync(path.join(homeDir, '.config', 'opencode', 'opencode.jsonc'));

  // Ollama (local LLMs)
  found.ollama = commandExists('ollama');

  // Docker (already checked but include for completeness)
  found.docker = commandExists('docker');

  return found;
}

/**
 * Quick health check for `construct dev` — checks prerequisites + credentials.
 * @param {Object} options - Options
 * @param {string} options.homeDir - Home directory
 * @param {boolean} options.showCredentials - Show credential summary (default: false)
 * @returns {Promise<{ok: boolean, missing: string[], credentials: object}>}
 */
export async function quickHealthCheck(options = {}) {
  const { homeDir, showCredentials = false } = options;
  
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

  const credentials = showCredentials ? detectCredentials({ homeDir }) : {};
  
  return { ok: critical.length === 0, missing: critical, credentials };
}
