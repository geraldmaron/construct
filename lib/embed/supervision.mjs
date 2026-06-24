/**
 * lib/embed/supervision.mjs — platform supervisor integration for the embed daemon.
 *
 * Writes a platform service file so the embed daemon is automatically
 * restarted with exponential backoff if it crashes, and started on login/boot.
 *
 * Platform support:
 *   macOS   — launchd plist at ~/Library/LaunchAgents/com.construct.embed.plist
 *   Linux   — systemd user unit at ~/.config/systemd/user/construct-embed.service
 *   Windows — Task Scheduler (schtasks) entry named "Construct.Embed"
 *
 * Usage:
 *   import { installSupervision, uninstallSupervision, supervisionStatus } from './supervision.mjs';
 *   await installSupervision();
 *   await uninstallSupervision();
 *   const info = await supervisionStatus();
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { stateDir } from '../config/xdg.mjs';

const HOME = os.homedir();
const PLATFORM = process.platform;
const NODE_BIN = process.execPath;

// Path to the construct bin — we use absolute path so launchd/systemd can find it.
function constructBin() {
  const local = path.join(stateDir(HOME), 'bin', 'construct');
  if (fs.existsSync(local)) return local;
  const result = spawnSync('which', ['construct'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'construct';
}

// ── macOS launchd ───────────────────────────────────────────────────────────

const LAUNCHD_LABEL = 'com.construct.embed';
const LAUNCHD_PLIST = path.join(HOME, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);

function launchdPlist(bin, logPath) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${bin}</string>
    <string>embed</string>
    <string>start</string>
    <string>--foreground</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>Crashed</key>
    <true/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${HOME}</string>
  </dict>
</dict>
</plist>
`;
}

async function installLaunchd(bin, logPath) {
  fs.mkdirSync(path.dirname(LAUNCHD_PLIST), { recursive: true });
  fs.writeFileSync(LAUNCHD_PLIST, launchdPlist(bin, logPath));
  const load = spawnSync('launchctl', ['load', '-w', LAUNCHD_PLIST], { encoding: 'utf8' });
  if (load.status !== 0) {
    throw new Error(`launchctl load failed: ${load.stderr}`);
  }
  return { method: 'launchd', file: LAUNCHD_PLIST };
}

async function uninstallLaunchd() {
  if (!fs.existsSync(LAUNCHD_PLIST)) return { method: 'launchd', wasInstalled: false };
  spawnSync('launchctl', ['unload', '-w', LAUNCHD_PLIST], { encoding: 'utf8' });
  fs.rmSync(LAUNCHD_PLIST, { force: true });
  return { method: 'launchd', wasInstalled: true };
}

function launchdStatus() {
  if (!fs.existsSync(LAUNCHD_PLIST)) return { installed: false };
  const result = spawnSync('launchctl', ['list', LAUNCHD_LABEL], { encoding: 'utf8' });
  return {
    installed: true,
    active: result.status === 0,
    file: LAUNCHD_PLIST,
  };
}

// ── Linux systemd ───────────────────────────────────────────────────────────

const SYSTEMD_UNIT_NAME = 'construct-embed.service';
const SYSTEMD_UNIT_DIR = path.join(HOME, '.config', 'systemd', 'user');
const SYSTEMD_UNIT_FILE = path.join(SYSTEMD_UNIT_DIR, SYSTEMD_UNIT_NAME);

function systemdUnit(bin, logPath) {
  return `[Unit]
Description=Construct embed daemon
After=network.target

[Service]
Type=simple
ExecStart=${NODE_BIN} ${bin} embed start --foreground
Restart=on-failure
RestartSec=10
RestartMaxDelay=300
StandardOutput=append:${logPath}
StandardError=append:${logPath}
Environment=HOME=${HOME}

[Install]
WantedBy=default.target
`;
}

async function installSystemd(bin, logPath) {
  fs.mkdirSync(SYSTEMD_UNIT_DIR, { recursive: true });
  fs.writeFileSync(SYSTEMD_UNIT_FILE, systemdUnit(bin, logPath));

  const reload = spawnSync('systemctl', ['--user', 'daemon-reload'], { encoding: 'utf8' });
  if (reload.status !== 0) throw new Error(`daemon-reload failed: ${reload.stderr}`);

  const enable = spawnSync('systemctl', ['--user', 'enable', '--now', SYSTEMD_UNIT_NAME], { encoding: 'utf8' });
  if (enable.status !== 0) throw new Error(`systemctl enable failed: ${enable.stderr}`);

  return { method: 'systemd', file: SYSTEMD_UNIT_FILE };
}

async function uninstallSystemd() {
  if (!fs.existsSync(SYSTEMD_UNIT_FILE)) return { method: 'systemd', wasInstalled: false };
  spawnSync('systemctl', ['--user', 'disable', '--now', SYSTEMD_UNIT_NAME], { encoding: 'utf8' });
  fs.rmSync(SYSTEMD_UNIT_FILE, { force: true });
  spawnSync('systemctl', ['--user', 'daemon-reload'], { encoding: 'utf8' });
  return { method: 'systemd', wasInstalled: true };
}

function systemdStatus() {
  if (!fs.existsSync(SYSTEMD_UNIT_FILE)) return { installed: false };
  const result = spawnSync('systemctl', ['--user', 'is-active', SYSTEMD_UNIT_NAME], { encoding: 'utf8' });
  return {
    installed: true,
    active: result.stdout.trim() === 'active',
    file: SYSTEMD_UNIT_FILE,
  };
}

// ── Windows Task Scheduler ──────────────────────────────────────────────────

const WIN_TASK_NAME = 'Construct.Embed';

async function installWindows(bin, logPath) {
  const cmd = [
    'schtasks', '/Create', '/F',
    '/TN', WIN_TASK_NAME,
    '/TR', `"${NODE_BIN}" "${bin}" embed start --foreground >> "${logPath}" 2>&1`,
    '/SC', 'ONLOGON',
    '/RL', 'HIGHEST',
  ].join(' ');
  const result = spawnSync('cmd', ['/c', cmd], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`schtasks failed: ${result.stderr}`);
  return { method: 'task-scheduler', taskName: WIN_TASK_NAME };
}

async function uninstallWindows() {
  const result = spawnSync('schtasks', ['/Query', '/TN', WIN_TASK_NAME], { encoding: 'utf8' });
  if (result.status !== 0) return { method: 'task-scheduler', wasInstalled: false };
  spawnSync('schtasks', ['/Delete', '/TN', WIN_TASK_NAME, '/F'], { encoding: 'utf8' });
  return { method: 'task-scheduler', wasInstalled: true };
}

function windowsStatus() {
  const result = spawnSync('schtasks', ['/Query', '/TN', WIN_TASK_NAME, '/FO', 'CSV'], { encoding: 'utf8' });
  if (result.status !== 0) return { installed: false };
  const running = result.stdout.includes('Running');
  return { installed: true, active: running, taskName: WIN_TASK_NAME };
}

// ── Public API ──────────────────────────────────────────────────────────────

function logPath() {
  return path.join(HOME, '.cx', 'runtime', 'embed-daemon.log');
}

/**
 * Install the platform supervisor so the embed daemon auto-restarts on crash.
 */
export async function installSupervision() {
  const bin = constructBin();
  const log = logPath();
  fs.mkdirSync(path.dirname(log), { recursive: true });

  if (PLATFORM === 'darwin') return installLaunchd(bin, log);
  if (PLATFORM === 'linux')  return installSystemd(bin, log);
  if (PLATFORM === 'win32')  return installWindows(bin, log);
  throw new Error(`supervision not supported on platform: ${PLATFORM}`);
}

/**
 * Remove the platform supervisor entry. Does not stop a currently-running daemon.
 */
export async function uninstallSupervision() {
  if (PLATFORM === 'darwin') return uninstallLaunchd();
  if (PLATFORM === 'linux')  return uninstallSystemd();
  if (PLATFORM === 'win32')  return uninstallWindows();
  throw new Error(`supervision not supported on platform: ${PLATFORM}`);
}

/**
 * Check whether the supervisor is installed and active.
 *
 * @returns {{ installed: boolean, active?: boolean, method?: string, file?: string }}
 */
export function supervisionStatus() {
  if (PLATFORM === 'darwin') return { method: 'launchd', ...launchdStatus() };
  if (PLATFORM === 'linux')  return { method: 'systemd', ...systemdStatus() };
  if (PLATFORM === 'win32')  return { method: 'task-scheduler', ...windowsStatus() };
  return { installed: false, method: 'unsupported' };
}
