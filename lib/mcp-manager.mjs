/**
 * MCP manager — add, remove, list MCPs in host configs.
 * Uses the plugin registry as the source of truth for built-in and external integrations.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir, platform } from 'node:os';
import { join, dirname } from 'node:path';
import { selectOption } from './tty-prompts.mjs';
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
} from './mcp-platform-config.mjs';
import { getMcpById as getMcpByIdFromRegistry, loadPluginRegistry } from './plugin-registry.mjs';

function getClaudeSettingsPath() {
  return join(homedir(), '.claude', 'settings.json');
}

// VS Code's "MCP: Open User Configuration" edits a per-profile mcp.json keyed
// on top-level `servers`; Cursor uses ~/.cursor/mcp.json keyed on `mcpServers`.
// construct sync writes both surfaces, so remove must clean them too or a
// removed MCP lingers there.

function getVSCodeUserMcpPaths(home = homedir()) {
  const plat = platform();
  if (plat === 'darwin') {
    return [
      join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json'),
      join(home, 'Library', 'Application Support', 'Code - Insiders', 'User', 'mcp.json'),
    ];
  }
  if (plat === 'win32') {
    const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
    return [join(appData, 'Code', 'User', 'mcp.json'), join(appData, 'Code - Insiders', 'User', 'mcp.json')];
  }
  return [
    join(home, '.config', 'Code', 'User', 'mcp.json'),
    join(home, '.config', 'Code - Insiders', 'User', 'mcp.json'),
  ];
}

function getCursorMcpPath(home = homedir()) {
  return join(home, '.cursor', 'mcp.json');
}

function mcpFileHasEntry(file, key, id) {
  if (!existsSync(file)) return false;
  try {
    return Boolean(JSON.parse(readFileSync(file, 'utf8'))?.[key]?.[id]);
  } catch {
    return false;
  }
}

function removeMcpFromJsonFile(file, key, id) {
  if (!existsSync(file)) return false;
  let config;
  try {
    config = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
  if (!config?.[key] || !(id in config[key])) return false;
  delete config[key][id];
  writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  return true;
}

function openUrl(url) {
  try {
    const opener = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open';
    execSync(`${opener} "${url}"`, { stdio: 'ignore' });
  } catch { /* browser launch is non-critical */ }
}

function normalizeMcp(mcp) {
  return {
    ...mcp,
    args: Array.isArray(mcp.args) ? mcp.args : [],
    env: mcp.env && typeof mcp.env === 'object' ? mcp.env : {},
    requiredEnv: Array.isArray(mcp.requiredEnv) ? mcp.requiredEnv : [],
    setupModes: Array.isArray(mcp.setupModes) ? mcp.setupModes : ['manual'],
    usedBy: Array.isArray(mcp.usedBy) ? mcp.usedBy : [],
    hostSupport: mcp.hostSupport && typeof mcp.hostSupport === 'object' ? mcp.hostSupport : {},
  };
}

function hasSetupMode(mcp, mode) {
  return mcp.setupModes.includes(mode);
}

function getHostSupport(mcp, host) {
  const support = mcp?.hostSupport?.[host];
  if (!support) return { mode: 'managed' };
  if (typeof support === 'string') return { mode: support };
  if (typeof support === 'object') return { mode: support.mode ?? 'managed', ...support };
  return { mode: 'managed' };
}

function isManagedOnHost(mcp, host) {
  return getHostSupport(mcp, host).mode === 'managed';
}

function collectPluginBackedMcpIds(catalog) {
  return (catalog.mcps ?? [])
    .filter((mcp) => ['claude', 'opencode', 'codex'].some((host) => getHostSupport(mcp, host).mode === 'plugin'))
    .map((mcp) => mcp.id);
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

  return selectOption({
    title: 'Choose setup mode',
    instructions: 'Pick how Construct should configure this integration.',
    options: [
      {
        value: 'auto',
        label: 'Auto-configure',
        description: 'Let Construct detect, provision, or prefill what it can.',
      },
      {
        value: 'manual',
        label: 'Manual setup',
        description: 'Provide credentials, URLs, and config values yourself.',
      },
    ],
  });
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
  const claudeSettingsPath = getClaudeSettingsPath();
  if (!existsSync(claudeSettingsPath)) return {};
  try {
    return JSON.parse(readFileSync(claudeSettingsPath, 'utf8'));
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  const claudeSettingsPath = getClaudeSettingsPath();
  mkdirSync(dirname(claudeSettingsPath), { recursive: true });
  writeFileSync(claudeSettingsPath, JSON.stringify(settings, null, 2) + '\n');
}

function loadOpenCodeConfig() {
  return readOpenCodeConfig().config ?? {};
}

function saveOpenCodeConfig(config) {
  writeOpenCodeConfig(config);
}

function getMcpById(id) {
  return getMcpByIdFromRegistry(id, { cwd: process.cwd(), homeDir: homedir() });
}

function getInstalledMcps() {
  const registry = loadPluginRegistry({ cwd: process.cwd(), homeDir: homedir() });
  const settings = loadSettings();
  const oc = loadOpenCodeConfig();
  const codexConfig = readCodexConfig();
  const codexServers = Array.from(codexConfig.matchAll(/^\[mcp_servers\.("?)([^"\]\n]+)\1\]/gm)).map((match) => match[2]);
  const set = new Set([
    ...Object.keys(settings.mcpServers ?? {}),
    ...Object.keys(oc.mcp ?? {}),
    ...codexServers,
  ]);
  for (const id of collectPluginBackedMcpIds({ mcps: registry.mcps.map(normalizeMcp) })) {
    set.add(id);
  }
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
  const registry = loadPluginRegistry({ cwd: process.cwd(), homeDir: homedir() });
  const installed = new Set(getInstalledMcps());

  if (!registry.valid) {
    console.log('Plugin registry errors:');
    for (const error of registry.errors) console.log(`  ✗ ${error}`);
    console.log('');
  }

  const categories = ['core', 'optional', 'integration'];
  const labels = { core: 'Core (Essential)', optional: 'Enhancements', integration: 'Third-Party' };

  for (const cat of categories) {
    const mcps = registry.mcps.filter(m => m.category === cat);
    if (!mcps.length) continue;

    console.log(`\n${labels[cat]}:`);
    console.log('─'.repeat(72));
    for (const mcp of mcps) {
      const status = installed.has(mcp.id) ? '✓' : '·';
      const name = mcp.name.padEnd(20);
      const req = mcp.requiredEnv.length ? ` [needs: ${mcp.requiredEnv.join(', ')}]` : '';
      const source = mcp.pluginId !== 'construct-builtins' ? ` [plugin: ${mcp.pluginId}]` : '';
      console.log(`  ${status} ${name} ${mcp.description.substring(0, 50)}${req}${source}`);
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

  // GitHub's hosted remote server uses one-click OAuth by default: the host runs
  // the browser flow and stores the token in its own secure store, so we wire the
  // URL only and keep no credential. `--token`/`--pat` opts into the PAT fallback
  // (headless/CI), sourced from gh CLI or env and emitted as an env reference.
  let authMode = id === 'github' ? 'oauth' : 'pat';
  if (id === 'github' && (flags.token || flags.pat)) {
    authMode = 'pat';
    const envToken = process.env.GITHUB_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    let ghCliToken = '';
    try {
      execSync('gh auth status -h github.com', { stdio: 'ignore' });
      ghCliToken = execSync('gh auth token -h github.com 2>/dev/null', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch { /* gh not installed or not authed */ }

    const best = envToken || ghCliToken;
    if (process.stdin.isTTY && typeof flags.token !== 'string') {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const hint = best ? ' [press Enter to use detected token]' : '';
      const value = await prompt(rl, `\n   > GITHUB_TOKEN${hint}: `);
      rl.close();
      envValues.GITHUB_TOKEN = value.trim() || best || '';
    } else {
      envValues.GITHUB_TOKEN = (typeof flags.token === 'string' ? flags.token : '') || best || '';
    }
    if (!envValues.GITHUB_TOKEN) {
      console.log('\n   ✗ --token requested but no PAT found (gh CLI / env / prompt).');
      console.log('   Run `gh auth login -h github.com`, or omit --token to use OAuth.');
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
  if (isManagedOnHost(mcp, 'claude')) {
    settings.mcpServers[id] = buildClaudeMcpEntry(id, mcp, resolvedValues, { auth: authMode });
  } else {
    delete settings.mcpServers[id];
  }
  saveSettings(settings);

  // Write to OpenCode config
  const oc = loadOpenCodeConfig();
  if (!oc.mcp) oc.mcp = {};
  const openCodeId = getOpenCodeMcpId(id);
  delete oc.mcp[id];
  if (id === 'memory') delete oc.mcp.cass;
  if (isManagedOnHost(mcp, 'opencode')) {
    oc.mcp[openCodeId] = buildOpenCodeMcpEntry(id, mcp, resolvedValues, { auth: authMode }).entry;
  } else {
    delete oc.mcp[openCodeId];
  }
  saveOpenCodeConfig(oc);

  if (isManagedOnHost(mcp, 'codex')) {
    writeCodexMcp(id, mcp, resolvedValues);
  } else {
    removeCodexMcp(id);
  }

  // --- SYNC TO .ENV ---
  const envPath = getUserEnvPath(homedir());
  writeEnvValues(envPath, envValues);
  console.log(`✓ Credentials synchronized to ${envPath}`);
  // --------------------

  console.log(`\n✓ ${mcp.name} successfully wired into Claude Code, OpenCode, and Codex.`);
  console.log(`✓ Setup mode: ${setupMode}`);
  console.log(`✓ Auth: ${id === 'github' ? authMode : 'managed'}`);
  console.log(`✓ Services synchronized.`);
  console.log(`\nNext: Restart OpenCode, Claude Code, or Codex to activate the new tools.`);
  if (id === 'github' && authMode === 'oauth') {
    console.log(`\nAuthenticate (one-click OAuth, no token stored on disk):`);
    console.log(`   Claude Code: \`claude mcp login github\`   ·   OpenCode: \`opencode mcp auth github\``);
    console.log(`   VS Code / Cursor: approve the sign-in prompt on first use.`);
    console.log(`   PAT fallback (headless/CI): \`construct mcp add github --token\``);
  }
  for (const host of ['claude', 'opencode', 'codex']) {
    const support = getHostSupport(mcp, host);
    const hostLabel = host === 'claude' ? 'Claude Code' : host === 'opencode' ? 'OpenCode' : 'Codex';
    if (support.mode === 'plugin') {
      console.log(`      ${hostLabel} uses ${support.label ?? 'a native plugin/app path'} for ${mcp.name}; Construct does not install a standalone MCP there.`);
    } else if (support.mode === 'unsupported') {
      console.log(`      ${hostLabel} does not support managed ${mcp.name} setup.`);
    }
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
  const vscodePaths = getVSCodeUserMcpPaths();
  const cursorPath = getCursorMcpPath();
  const hasClaudeEntry = Boolean(settings.mcpServers?.[id]);
  const hasOpenCodeEntry = Boolean(oc.mcp?.[openCodeId] || oc.mcp?.[id] || (id === 'memory' && oc.mcp?.cass));
  const hasCodexEntry = readCodexConfig().includes(`[mcp_servers.${id}]`) || readCodexConfig().includes(`[mcp_servers.${tomlString(id)}]`);
  const hasVscodeEntry = vscodePaths.some((p) => mcpFileHasEntry(p, 'servers', id));
  const hasCursorEntry = mcpFileHasEntry(cursorPath, 'mcpServers', id);
  if (!hasClaudeEntry && !hasOpenCodeEntry && !hasCodexEntry && !hasVscodeEntry && !hasCursorEntry) {
    console.log(`${id} is not installed. Nothing to remove.`);
    return;
  }

  const mcp = getMcpById(id);
  const name = mcp?.name ?? id;

  if (settings.mcpServers) delete settings.mcpServers[id];
  saveSettings(settings);

  if (oc.mcp) {
    delete oc.mcp[openCodeId];
    delete oc.mcp[id];
    if (id === 'memory') delete oc.mcp.cass;
  }
  if (openCodeState.config || hasOpenCodeEntry) saveOpenCodeConfig(oc);
  else if (openCodeState.file && existsSync(openCodeState.file)) rmSync(openCodeState.file, { force: true });
  removeCodexMcp(id);
  for (const p of vscodePaths) removeMcpFromJsonFile(p, 'servers', id);
  removeMcpFromJsonFile(cursorPath, 'mcpServers', id);

  console.log(`✓ ${name} removed from Claude Code, OpenCode, Codex, VS Code, and Cursor config`);
  console.log('Restart the editor to deactivate it.');
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
  console.log(`Plugin:   ${mcp.pluginName} (${mcp.pluginId})`);
  if (mcp.package) console.log(`Package:  ${mcp.package}`);
  console.log(`\n${mcp.description}`);
  if (mcp.setupUrl) console.log(`\nSetup:    ${mcp.setupUrl}`);
  if (mcp.setupNote) console.log(`          ${mcp.setupNote}`);
  if (mcp.requiredEnv.length) console.log(`\nRequires: ${mcp.requiredEnv.join(', ')}`);
  if (mcp.usedBy.length) console.log(`Used by:  ${mcp.usedBy.join(', ')}`);
  console.log(`\nDegraded: ${mcp.degradedMessage}`);
  console.log('');
}
