#!/usr/bin/env node
/**
 * lib/health-check.mjs — reusable prerequisite and health checks.
 *
 * Prerequisite and health check runners for `construct dev`, `construct doctor`,
 * and `construct init`.
 */

import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { extractOpRef, hasAnySecret, hasSecret } from './providers/secret-resolver.mjs';
import { configDir } from './config/xdg.mjs';

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
    why: 'Required for managed Postgres; trace capture works locally without Docker',
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
  const hasUserConfig = existsSync(path.join(configDir(homeDir || os.homedir()), 'config.env')) ||
                        existsSync(configDir(homeDir || os.homedir()));
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
 * Read a credential raw value from dotenv files and shell rc without invoking
 * `op read`. Returns op:// references as-is so callers can persist or report
 * presence without biometric prompts (ADR-0042).
 */
function readCredentialRaw(varName, homeDir) {
  if (process.env[varName]) return process.env[varName];

  for (const envPath of [
    path.join(process.cwd(), '.env'),
    path.join(homeDir, '.env'),
    path.join(configDir(homeDir), 'config.env'),
  ]) {
    if (!existsSync(envPath)) continue;
    try {
      const content = readFileSync(envPath, 'utf8');
      const m = content.match(new RegExp(`^${varName}=["']?(.+?)["']?$`, 'm'));
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
      const opRe = new RegExp(`export\\s+${varName}=["']?\\$\\(op read '([^']+)'\\)["']?`, 'm');
      const opMatch = content.match(opRe);
      if (opMatch) return opMatch[1];
      const directRe = new RegExp(`^\\s*export\\s+${varName}=(.+)$`, 'm');
      const directMatch = content.match(directRe);
      if (directMatch) return directMatch[1].trim().replace(/^["']|["']$/g, '');
    } catch { /* skip */ }
  }

  return null;
}

/**
 * Describe where a credential is configured without resolving op:// refs.
 */
export function describeCredentialPresence(varName, { homeDir = os.homedir(), cwd = process.cwd() } = {}) {
  const sources = [];
  const direct = process.env[varName];
  if (direct) {
    const ref = extractOpRef(direct);
    sources.push(ref ? `process.env (op:// ref)` : `process.env (plain value)`);
  }

  for (const envPath of [
    path.join(cwd, '.env'),
    path.join(homeDir, '.env'),
    path.join(configDir(homeDir), 'config.env'),
  ]) {
    if (!existsSync(envPath)) continue;
    try {
      const content = readFileSync(envPath, 'utf8');
      const m = content.match(new RegExp(`^${varName}=["']?(.+?)["']?$`, 'm'));
      if (m) {
        const ref = extractOpRef(m[1]);
        const label = envPath.replace(homeDir, '~');
        sources.push(ref ? `${label} (op:// ref)` : `${label} (plain value)`);
      }
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
      const opRe = new RegExp(`export\\s+${varName}=["']?\\$\\(op read '([^']+)'\\)["']?`, 'm');
      if (opRe.test(content)) {
        sources.push(`${rcPath.replace(homeDir, '~')} (op read in rc — use op:// in config.env instead)`);
      }
      const directRe = new RegExp(`^\\s*export\\s+${varName}=`, 'm');
      if (directRe.test(content) && !sources.some((s) => s.includes(rcPath.replace(homeDir, '~')))) {
        sources.push(`${rcPath.replace(homeDir, '~')} (export found)`);
      }
    } catch { /* skip */ }
  }

  return { configured: hasSecret(varName, { env: process.env, cwd }), sources };
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
 * Link discovered credential references into the XDG config dir config.env without
 * invoking `op read`. Plain values and op:// refs are persisted as found.
 * @param {Object} options
 * @param {string} options.homeDir
 * @param {boolean} options.writeConfig - Write keys to config.env (default: false)
 * @returns {Promise<Record<string, string>>} raw values linked (never plaintext from op)
 */
export async function resolveCredentials(options = {}) {
  const { homeDir = os.homedir(), writeConfig = false } = options;
  const linked = {};
  const { parseEnvFile, getUserEnvPath, writeEnvValues } = await import('./env-config.mjs');
  const existing = parseEnvFile(getUserEnvPath(homeDir));

  for (const varName of CREDENTIAL_VARS) {
    if (existing[varName]) continue;
    const raw = readCredentialRaw(varName, homeDir);
    if (!raw) continue;
    const ref = extractOpRef(raw);
    linked[varName] = ref || raw;
  }

  if (writeConfig && Object.keys(linked).length > 0) {
    try {
      writeEnvValues(getUserEnvPath(homeDir), linked);
    } catch { /* best effort */ }
  }

  return linked;
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

  // GitHub Copilot: a device-flow credential (Construct's own store or the shared
  // github-copilot store) is the usable signal; the VS Code extension and the
  // copilot CLI are softer fallbacks.
  const copilotAuthStore = existsSync(path.join(configDir(homeDir), 'auth', 'github-copilot.json')) ||
    existsSync(path.join(homeDir, '.config', 'github-copilot', 'apps.json')) ||
    existsSync(path.join(homeDir, '.config', 'github-copilot', 'hosts.json'));
  const copilotDir = path.join(homeDir, '.vscode', 'extensions');
  const copilotExists = existsSync(copilotDir) && existsSync(path.join(homeDir, '.config', 'Code', 'User', 'globalStorage', 'github.copilot'));
  found.copilot = copilotAuthStore || copilotExists || commandExists('copilot');

  // OpenRouter API key
  found.openrouter_key = hasAnySecret(['OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY'], { env: process.env, cwd: process.cwd() });

  found.anthropic_key = hasAnySecret(['ANTHROPIC_API_KEY'], { env: process.env, cwd: process.cwd() });

  found.openai_key = hasAnySecret(['OPENAI_API_KEY'], { env: process.env, cwd: process.cwd() });

  found.github_token = hasAnySecret(['GITHUB_TOKEN', 'GH_TOKEN'], { env: process.env, cwd: process.cwd() });

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
