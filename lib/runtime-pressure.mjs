/**
 * lib/runtime-pressure.mjs — Manage local memory-pressure guard defaults.
 *
 * Defines configurable thresholds for helper cleanup, emits environment
 * values consumed by setup flows, and runs local diagnostics used by the
 * guard verification tests.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULTS = Object.freeze({
  enabled: '1',
  intervalSeconds: '300',
  swapGb: '6',
  maxOpencode: '2',
  maxOpencodeAgeHours: '24',
  maxHelperAgeHours: '2',
  maxCassIndexAgeHours: '8',
});

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function thresholdConfig(env = process.env) {
  return {
    enabled: String(env.CONSTRUCT_PRESSURE_GUARD_ENABLED ?? DEFAULTS.enabled) !== '0',
    intervalSeconds: parsePositiveInt(env.CONSTRUCT_PRESSURE_GUARD_INTERVAL_SECONDS, Number(DEFAULTS.intervalSeconds)),
    swapGb: parsePositiveInt(env.CONSTRUCT_PRESSURE_GUARD_SWAP_GB, Number(DEFAULTS.swapGb)),
    maxOpencodeProcesses: parsePositiveInt(env.CONSTRUCT_PRESSURE_GUARD_MAX_OPENCODE, Number(DEFAULTS.maxOpencode)),
    maxOpencodeAgeHours: parsePositiveInt(env.CONSTRUCT_PRESSURE_GUARD_MAX_OPENCODE_AGE_HOURS, Number(DEFAULTS.maxOpencodeAgeHours)),
    maxHelperAgeHours: parsePositiveInt(env.CONSTRUCT_PRESSURE_GUARD_MAX_HELPER_AGE_HOURS, Number(DEFAULTS.maxHelperAgeHours)),
    maxCassIndexAgeHours: parsePositiveInt(env.CONSTRUCT_PRESSURE_GUARD_MAX_CASS_INDEX_AGE_HOURS, Number(DEFAULTS.maxCassIndexAgeHours)),
  };
}

export function buildPressureGuardValues({ env = process.env } = {}) {
  const config = thresholdConfig(env);
  return {
    CONSTRUCT_PRESSURE_GUARD_ENABLED: config.enabled ? '1' : '0',
    CONSTRUCT_PRESSURE_GUARD_INTERVAL_SECONDS: String(config.intervalSeconds),
    CONSTRUCT_PRESSURE_GUARD_SWAP_GB: String(config.swapGb),
    CONSTRUCT_PRESSURE_GUARD_MAX_OPENCODE: String(config.maxOpencodeProcesses),
    CONSTRUCT_PRESSURE_GUARD_MAX_OPENCODE_AGE_HOURS: String(config.maxOpencodeAgeHours),
    CONSTRUCT_PRESSURE_GUARD_MAX_HELPER_AGE_HOURS: String(config.maxHelperAgeHours),
    CONSTRUCT_PRESSURE_GUARD_MAX_CASS_INDEX_AGE_HOURS: String(config.maxCassIndexAgeHours),
  };
}

export function parseElapsedSeconds(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return Number(raw);
  const daySplit = raw.split('-');
  const clock = daySplit.pop();
  const days = daySplit.length ? Number.parseInt(daySplit[0], 10) || 0 : 0;
  const parts = clock.split(':').map((part) => Number.parseInt(part, 10) || 0);
  if (parts.length === 2) return (days * 86400) + (parts[0] * 60) + parts[1];
  if (parts.length === 3) return (days * 86400) + (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  return 0;
}

export function parseSwapUsage(output) {
  const text = String(output ?? '');
  const total = text.match(/total = ([0-9.]+)M/);
  const used = text.match(/used = ([0-9.]+)M/);
  const free = text.match(/free = ([0-9.]+)M/);
  if (!total || !used || !free) return null;
  const toBytes = (value) => Math.round(Number.parseFloat(value) * 1024 * 1024);
  return {
    totalBytes: toBytes(total[1]),
    usedBytes: toBytes(used[1]),
    freeBytes: toBytes(free[1]),
  };
}

function isOpencodeCommand(command) {
  return /^opencode(?:\s|$)/.test(command);
}

function isHelperCommand(command) {
  return /(context7-mcp|playwright-mcp|mcp-server-sequential-thinking)/.test(command);
}

function isCassIndexCommand(command) {
  return /\bcass index\b/.test(command);
}

function summarizeTermination(entries) {
  if (!entries.length) return 'No stale dev-agent processes matched the current policy.';
  return `Pressure guard selected ${entries.length} processes for cleanup.`;
}

export function buildCleanupPlan(processEntries = [], thresholds = {}) {
  const maxOpencodeProcesses = thresholds.maxOpencodeProcesses ?? 2;
  const maxOpencodeAgeSeconds = (thresholds.maxOpencodeAgeHours ?? 24) * 3600;
  const maxHelperAgeSeconds = (thresholds.maxHelperAgeHours ?? 2) * 3600;
  const maxCassIndexAgeSeconds = (thresholds.maxCassIndexAgeHours ?? 8) * 3600;

  const terminate = [];
  const seen = new Set();

  const opencode = processEntries.filter((entry) => isOpencodeCommand(entry.command));
  const staleOpencode = opencode
    .filter((entry) => entry.elapsedSeconds >= maxOpencodeAgeSeconds)
    .sort((a, b) => b.elapsedSeconds - a.elapsedSeconds);
  for (const entry of staleOpencode) {
    if (!seen.has(entry.pid)) {
      seen.add(entry.pid);
      terminate.push({ ...entry, reason: 'stale-opencode' });
    }
  }
  const duplicateOpencode = opencode
    .slice()
    .sort((a, b) => b.elapsedSeconds - a.elapsedSeconds)
    .slice(Math.max(0, maxOpencodeProcesses));
  for (const entry of duplicateOpencode) {
    if (!seen.has(entry.pid)) {
      seen.add(entry.pid);
      terminate.push({ ...entry, reason: 'duplicate-opencode' });
    }
  }

  const helpers = processEntries
    .filter((entry) => isHelperCommand(entry.command) && entry.elapsedSeconds >= maxHelperAgeSeconds)
    .sort((a, b) => b.elapsedSeconds - a.elapsedSeconds);
  for (const entry of helpers) {
    if (!seen.has(entry.pid)) {
      seen.add(entry.pid);
      terminate.push({ ...entry, reason: 'stale-helper' });
    }
  }

  const cassCandidates = processEntries
    .filter((entry) => isCassIndexCommand(entry.command) && entry.elapsedSeconds >= maxCassIndexAgeSeconds)
    .sort((a, b) => b.elapsedSeconds - a.elapsedSeconds)
    .map((entry) => ({ ...entry, reason: 'stale-cass-index' }));

  return {
    terminate,
    cassCandidates,
    summary: summarizeTermination(terminate),
  };
}

function parsePsLine(line) {
  const match = line.match(/^\s*(\d+)\s+(\d+)\s+([0-9:-]+)\s+(.*)$/);
  if (!match) return null;
  return {
    pid: Number(match[1]),
    rssKb: Number(match[2]),
    elapsedSeconds: parseElapsedSeconds(match[3]),
    command: match[4],
  };
}

export function listPressureProcesses({ spawnSyncFn = spawnSync } = {}) {
  const result = spawnSyncFn('ps', ['-ax', '-o', 'pid=,rss=,etime=,command='], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.status !== 0) return [];
  return String(result.stdout || '')
    .split(/\r?\n/)
    .map(parsePsLine)
    .filter(Boolean)
    .filter((entry) => isOpencodeCommand(entry.command) || isHelperCommand(entry.command) || isCassIndexCommand(entry.command));
}

export function readSwapUsage({ spawnSyncFn = spawnSync } = {}) {
  const result = spawnSyncFn('sysctl', ['vm.swapusage'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.status !== 0) return null;
  return parseSwapUsage(result.stdout);
}

function thresholdBytes(gb) {
  return gb * 1024 * 1024 * 1024;
}

export function runPressureRelease({
  env = process.env,
  processEntries,
  swapUsage,
  spawnSyncFn = spawnSync,
  killFn = process.kill.bind(process),
  force = false,
} = {}) {
  const config = thresholdConfig(env);
  const entries = processEntries ?? listPressureProcesses({ spawnSyncFn });
  const swap = swapUsage ?? readSwapUsage({ spawnSyncFn });
  const plan = buildCleanupPlan(entries, config);
  const pressureTriggered = force || Boolean(swap && swap.usedBytes >= thresholdBytes(config.swapGb));
  const targets = [...plan.terminate];
  if (pressureTriggered) targets.push(...plan.cassCandidates);

  const killed = [];
  for (const entry of targets) {
    try {
      killFn(entry.pid, 'SIGTERM');
      killed.push({ pid: entry.pid, reason: entry.reason });
    } catch {
      // best effort
    }
  }

  return {
    pressureTriggered,
    swapUsage: swap,
    config,
    plan,
    killed,
  };
}

function plistEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function installPressureGuardLaunchAgent({
  homeDir = os.homedir(),
  rootDir,
  intervalSeconds = Number(DEFAULTS.intervalSeconds),
  nodePath = process.execPath,
} = {}) {
  const launchAgentsDir = path.join(homeDir, 'Library', 'LaunchAgents');
  fs.mkdirSync(launchAgentsDir, { recursive: true });
  const plistPath = path.join(launchAgentsDir, 'dev.construct.pressure-release.plist');
  const programArgs = [
    nodePath,
    path.join(rootDir, 'bin', 'construct'),
    'cleanup',
    '--pressure-release',
    '--quiet',
  ];
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>dev.construct.pressure-release</string>
    <key>ProgramArguments</key>
    <array>
${programArgs.map((arg) => `      <string>${plistEscape(arg)}</string>`).join('\n')}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StartInterval</key>
    <integer>${intervalSeconds}</integer>
    <key>StandardOutPath</key>
    <string>${plistEscape(path.join(homeDir, '.construct', 'runtime', 'pressure-release.log'))}</string>
    <key>StandardErrorPath</key>
    <string>${plistEscape(path.join(homeDir, '.construct', 'runtime', 'pressure-release.log'))}</string>
  </dict>
</plist>
`;
  fs.writeFileSync(plistPath, plist, 'utf8');
  return { installed: true, plistPath };
}

export function loadPressureGuardLaunchAgent({
  plistPath,
  spawnSyncFn = spawnSync,
} = {}) {
  if (!plistPath || !fs.existsSync(plistPath)) return { loaded: false, reason: 'missing-plist' };
  spawnSyncFn('launchctl', ['unload', plistPath], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const result = spawnSyncFn('launchctl', ['load', '-w', plistPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status === 0) return { loaded: true };
  return {
    loaded: false,
    reason: (result.stderr || result.stdout || 'launchctl load failed').trim().split('\n')[0],
  };
}
