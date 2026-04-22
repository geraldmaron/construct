/**
 * MCP manager — add, remove, list MCPs in ~/.claude/settings.json
 * Uses mcp-catalog.json as the source of truth for known integrations.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir, platform } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readOpenCodeConfig, writeOpenCodeConfig } from './opencode-config.mjs';
import { getUserEnvPath, loadConstructEnv, writeEnvValues } from './env-config.mjs';
import {
  buildCodexMcpEntry,
  getCodexConfigPath,
  readCodexConfig,
  removeDanglingConstructMcpMarkers,
  removeDanglingConstructMcpTimeouts,
  removeTomlTables,
  serializeCodexMcpTable,
  tomlString,
  writeCodexConfig,
} from './codex-config.mjs';
import {
  buildClaudeMcpEntry,
  buildOpenCodeMcpEntry,
  getOpenCodeMcpId,
  normalizeInstalledOpenCodeMcpId,
} from './mcp-platform-config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CATALOG_PATH = join(__dirname, 'mcp-catalog.json');
const CLAUDE_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');

function openUrl(url) {
  try {
    const opener = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open';
    execSync(`${opener} "${url}"`, { stdio: 'ignore' });
  } catch {
    // best effort
  }
}

function loadCatalog() {
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
  return {
    ...catalog,
    mcps: (catalog.mcps ?? []).map(normalizeMcp),
  };
}

function normalizeMcp(mcp) {
  return {
    ...mcp,
    args: Array.isArray(mcp.args) ? mcp.args : [],
    env: mcp.env && typeof mcp.env === 'object' ? mcp.env : {},
    requiredEnv: Array.isArray(mcp.requiredEnv) ? mcp.requiredEnv : [],
    setupModes: Array.isArray(mcp.setupModes) ? mcp.setupModes : ['manual'],
    usedBy: Array.isArray(mcp.usedBy) ? mcp.usedBy : [],
  };
}

function hasSetupMode(mcp, mode) {
  return mcp.setupModes.includes(mode);
}

function parseAddFlags() {
  const args = new Set(process.argv.slice(2));
  return {
    auto: args.has('--auto'),
    manual: args.has('--manual'),
    token: args.has('--token'),
  };
}

async function chooseSetupMode(mcp, flags) {
  const canAuto = hasSetupMode(mcp, 'auto');
  const canManual = hasSetupMode(mcp, 'manual');

  if (!canAuto && !canManual) return 'manual';
  if (flags.auto && canAuto) return 'auto';
  if (flags.manual && canManual) return 'manual';
  if (!canAuto) return 'manual';
  if (!canManual) return 'auto';
  if (!process.stdin.isTTY) return 'manual';

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log('\nSetup mode:');
  console.log('  1) Auto-configure what Construct can detect or provision');
  console.log('  2) Manual setup (I will provide credentials/URLs myself)');
  const answer = await prompt(rl, '  Choice [1/2]: ');
  rl.close();
  return answer.trim() === '2' ? 'manual' : 'auto';
}

function getConfiguredEnvValue(name) {
  const configuredEnv = loadConstructEnv({ env: process.env });
  if (name === 'GITHUB_TOKEN') {
    return configuredEnv.GITHUB_TOKEN || configuredEnv.GITHUB_PERSONAL_ACCESS_TOKEN || '';
  }
  return configuredEnv[name] || '';
}

function getTemplateVariableNames(input) {
  if (!input || typeof input !== 'object') return [];
  const names = new Set();
  for (const value of Object.values(input)) {
    if (typeof value !== 'string') continue;
    for (const match of value.matchAll(/__([A-Z0-9_]+)__/g)) {
      names.add(match[1]);
    }
  }
  return Array.from(names);
}

function getConfiguredEnvValues(mcp) {
  const names = new Set([
    ...mcp.requiredEnv,
    ...getTemplateVariableNames(mcp.env),
    ...getTemplateVariableNames(mcp.headers),
  ]);
  const values = {};
  for (const name of names) {
    const value = getConfiguredEnvValue(name);
    if (value) values[name] = value;
  }
  return values;
}

function loadSettings() {
  if (!existsSync(CLAUDE_SETTINGS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  mkdirSync(dirname(CLAUDE_SETTINGS_PATH), { recursive: true });
  writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
}

function loadOpenCodeConfig() {
  return readOpenCodeConfig().config ?? {};
}

function saveOpenCodeConfig(config) {
  writeOpenCodeConfig(config);
}

function getMcpById(id) {
  const catalog = loadCatalog();
  return catalog.mcps.find(m => m.id === id) ?? null;
}

function getInstalledMcps() {
  const settings = loadSettings();
  const oc = loadOpenCodeConfig();
  const codexConfig = readCodexConfig();
  const codexServers = Array.from(codexConfig.matchAll(/^\[mcp_servers\.("?)([^"\]\n]+)\1\]/gm)).map((match) => match[2]);
  const set = new Set([
    ...Object.keys(settings.mcpServers ?? {}),
    ...Object.keys(oc.mcp ?? {}).map(normalizeInstalledOpenCodeMcpId),
    ...codexServers,
  ]);
  return Array.from(set);
}

function prompt(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function writeCodexMcp(id, mcp, resolvedValues) {
  const configPath = getCodexConfigPath(homedir());
  const existing = removeDanglingConstructMcpMarkers(removeDanglingConstructMcpTimeouts(readCodexConfig(configPath)));
  const cleaned = removeDanglingConstructMcpMarkers(removeTomlTables(existing, [`mcp_servers.${id}`, `mcp_servers.${tomlString(id)}`]));
  const table = serializeCodexMcpTable(id, buildCodexMcpEntry(id, mcp, resolvedValues));
  writeCodexConfig(`${cleaned.trimEnd()}\n\n${table}`, configPath);
}

function removeCodexMcp(id) {
  const configPath = getCodexConfigPath(homedir());
  const existing = readCodexConfig(configPath);
  if (!existing) return false;
  const cleaned = removeTomlTables(existing, [`mcp_servers.${id}`, `mcp_servers.${tomlString(id)}`]);
  if (cleaned === existing.trimEnd()) return false;
  writeCodexConfig(cleaned, configPath);
  return true;
}

/**
 * construct mcp list
 * Show all MCPs from catalog with installed/missing status.
 */
export function cmdMcpList() {
  const catalog = loadCatalog();
  const installed = new Set(getInstalledMcps());

  const categories = ['core', 'optional', 'integration'];
  const labels = { core: 'Core (Essential)', optional: 'Enhancements', integration: 'Third-Party' };

  for (const cat of categories) {
    const mcps = catalog.mcps.filter(m => m.category === cat);
    if (!mcps.length) continue;

    console.log(`\n${labels[cat]}:`);
    console.log('─'.repeat(72));
    for (const mcp of mcps) {
      const status = installed.has(mcp.id) ? '✓' : '·';
      const name = mcp.name.padEnd(20);
      const req = mcp.requiredEnv.length ? ` [needs: ${mcp.requiredEnv.join(', ')}]` : '';
      console.log(`  ${status} ${name} ${mcp.description.substring(0, 50)}${req}`);
    }
  }

  console.log('\n  Run "construct mcp add <name>" to set up an integration.');
}

/**
 * construct mcp add <id>
 * Interactive Guided Wizard: collect required env vars and write to settings.json.
 */
export async function cmdMcpAdd(id) {
  const mcp = getMcpById(id);
  if (!mcp) {
    console.error(`Unknown MCP: "${id}"`);
    console.error('Run "construct mcp list" to see available integrations.');
    process.exit(1);
  }

  console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║             CONSTRUCT SETUP WIZARD: ${mcp.name.toUpperCase().padEnd(16)} ║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝`);
  console.log(`\n${mcp.description}`);

  const flags = parseAddFlags();
  const setupMode = await chooseSetupMode(mcp, flags);
  const isAuto = setupMode === 'auto';

  const envValues = {};
  const resolvedValues = { ...process.env };

  // --- AUTO-PROVISIONING LOGIC ---
  if (id === 'memory' && isAuto) {
    const port = process.env.MEMORY_PORT || 8765;
    const isLocalHealthy = await new Promise(resolve => {
      try {
        execSync(`curl -sf http://localhost:${port}`, { stdio: 'ignore' });
        resolve(true);
      } catch {
        resolve(false);
      }
    });

    if (isLocalHealthy || isAuto) {
      console.log(`\n   ✓ Local Memory detected at port ${port}. Auto-configuring...`);
    }
  }

  // GitHub: source token from gh CLI, env, or prompt (--token flag)
  if (id === 'github') {
    const envToken = process.env.GITHUB_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    const forceToken = flags.token;

    let ghCliToken = '';
    try {
      execSync('gh auth status -h github.com', { stdio: 'ignore' });
      ghCliToken = execSync('gh auth token -h github.com 2>/dev/null', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch { /* gh not installed or not authed */ }

    if (forceToken) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const best = envToken || ghCliToken;
      const hint = best ? ' [press Enter to use detected token]' : '';
      const value = await prompt(rl, `\n   > GITHUB_TOKEN${hint}: `);
      rl.close();
      envValues.GITHUB_TOKEN = value.trim() || best || '';
    } else if (ghCliToken) {
      console.log('\n   ✓ GitHub token sourced from gh CLI (gh auth login).');
      envValues.GITHUB_TOKEN = ghCliToken;
    } else if (envToken) {
      console.log('\n   ✓ GitHub token detected in environment.');
      envValues.GITHUB_TOKEN = envToken;
    } else {
      console.log('\n   ✗ No GitHub token found.');
      console.log('   Run: gh auth login -h github.com    (opens browser, stores token automatically)');
      console.log('   Then re-run: construct mcp add github');
      console.log('   Or provide a PAT: construct mcp add github --token');
      process.exit(1);
    }
  }
  // -------------------------------

  for (const [key, value] of Object.entries(getConfiguredEnvValues(mcp))) {
    if (!envValues[key]) envValues[key] = value;
  }

  // Only open URLs and ask for credentials if auto-provisioning didn't find them and not in --auto mode
  if (mcp.requiredEnv.length > 0 && Object.keys(envValues).length === 0 && !isAuto) {
    if (mcp.setupUrl) {
      console.log(`\n1. OPENING AUTHORIZATION PAGE...`);
      console.log(`   URL: ${mcp.setupUrl}`);
      openUrl(mcp.setupUrl);
      console.log(`\n2. GUIDANCE:`);
      console.log(`   ${mcp.setupNote}`);
    }

    console.log(`\n3. ENTER CREDENTIALS:`);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    for (const envKey of mcp.requiredEnv) {
      let current = process.env[envKey];
      if (envKey === 'GITHUB_TOKEN' && !current) {
        current = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
      }
      const hint = current ? ` [detected in env]` : '';
      const value = await prompt(rl, `   > ${envKey}${hint}: `);
      envValues[envKey] = value.trim() || current || '';
    }
    rl.close();
  }

  // Validate all required env vars are present
  for (const key of mcp.requiredEnv) {
    if (!envValues[key]) {
      console.error(`\nError: ${key} is required. Setup cancelled.`);
      process.exit(1);
    }
  }

  Object.assign(resolvedValues, envValues);
  if (mcp.type === 'url' && id === 'memory') {
    resolvedValues.MEMORY_PORT = process.env.MEMORY_PORT || '8765';
  }

  // Write to Claude settings
  const settings = loadSettings();
  if (!settings.mcpServers) settings.mcpServers = {};
  settings.mcpServers[id] = buildClaudeMcpEntry(id, mcp, resolvedValues);
  saveSettings(settings);

  // Write to OpenCode config
  const oc = loadOpenCodeConfig();
  if (!oc.mcp) oc.mcp = {};
  const openCodeId = getOpenCodeMcpId(id);
  delete oc.mcp[id];
  oc.mcp[openCodeId] = buildOpenCodeMcpEntry(id, mcp, resolvedValues).entry;
  saveOpenCodeConfig(oc);

  // Write to Codex config. GitHub uses the official remote server URL so Codex
  // can authenticate via `codex mcp login github` instead of launching stale
  // local github-mcp-server binaries.
  writeCodexMcp(id, mcp, resolvedValues);

  // --- SYNC TO .ENV ---
  const envPath = getUserEnvPath(homedir());
  writeEnvValues(envPath, envValues);
  console.log(`✓ Credentials synchronized to ${envPath}`);
  // --------------------

  console.log(`\n✓ ${mcp.name} successfully wired into Claude Code, OpenCode, and Codex.`);
  console.log(`✓ Setup mode: ${setupMode}`);
  console.log(`✓ Services synchronized.`);
  console.log(`\nNext: Restart OpenCode, Claude Code, or Codex to activate the new tools.`);
  if (id === 'github') {
    console.log('      For Codex OAuth, run: codex mcp login github');
  }
  
  if (mcp.usedBy.length) {
    console.log(`\nAgents now empowered: ${mcp.usedBy.join(', ')}`);
  }
}

/**
 * construct mcp remove <id>
 */
export function cmdMcpRemove(id) {
  const settings = loadSettings();
  const openCodeState = readOpenCodeConfig();
  const oc = openCodeState.config ?? {};
  const openCodeId = getOpenCodeMcpId(id);
  const hasClaudeEntry = Boolean(settings.mcpServers?.[id]);
  const hasOpenCodeEntry = Boolean(oc.mcp?.[openCodeId] || oc.mcp?.[id]);
  const hasCodexEntry = readCodexConfig().includes(`[mcp_servers.${id}]`) || readCodexConfig().includes(`[mcp_servers.${tomlString(id)}]`);
  if (!hasClaudeEntry && !hasOpenCodeEntry && !hasCodexEntry) {
    console.error(`${id} is not installed.`);
    process.exit(1);
  }

  const mcp = getMcpById(id);
  const name = mcp?.name ?? id;

  if (settings.mcpServers) delete settings.mcpServers[id];
  saveSettings(settings);

  if (oc.mcp) {
    delete oc.mcp[openCodeId];
    delete oc.mcp[id];
  }
  if (openCodeState.config || hasOpenCodeEntry) saveOpenCodeConfig(oc);
  removeCodexMcp(id);

  console.log(`✓ ${name} removed from Claude Code, OpenCode, and Codex config`);
  console.log('Restart Claude Code, OpenCode, or Codex to deactivate it.');
}

/**
 * construct mcp info <id>
 */
export function cmdMcpInfo(id) {
  const mcp = getMcpById(id);
  if (!mcp) {
    console.error(`Unknown MCP: "${id}"`);
    process.exit(1);
  }

  const installed = getInstalledMcps().includes(id);

  console.log(`\n${mcp.name} (${mcp.id})`);
  console.log('─'.repeat(48));
  console.log(`Status:   ${installed ? '✓ installed' : '· not installed'}`);
  console.log(`Category: ${mcp.category}`);
  if (mcp.package) console.log(`Package:  ${mcp.package}`);
  console.log(`\n${mcp.description}`);
  if (mcp.setupUrl) console.log(`\nSetup:    ${mcp.setupUrl}`);
  if (mcp.setupNote) console.log(`          ${mcp.setupNote}`);
  if (mcp.requiredEnv.length) console.log(`\nRequires: ${mcp.requiredEnv.join(', ')}`);
  if (mcp.usedBy.length) console.log(`Used by:  ${mcp.usedBy.join(', ')}`);
  console.log(`\nDegraded: ${mcp.degradedMessage}`);
  console.log('');
}
