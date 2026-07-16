/**
 * lib/embed/supervision.mjs — platform supervisor integration for Construct
 * daemons (embed, oracle).
 *
 * Writes a platform service file so a daemon is automatically restarted with
 * exponential backoff if it crashes, and started on login/boot. The template
 * generators are parameterized by a service descriptor (SERVICES below) so
 * one set of launchd/systemd/Task Scheduler generators serves every
 * supervised daemon instead of being duplicated per service.
 *
 * Platform support (label/unit/task name derive from the service descriptor):
 *   macOS   — launchd plist at ~/Library/LaunchAgents/<launchdLabel>.plist
 *   Linux   — systemd user unit at ~/.config/systemd/user/<systemdUnit>
 *   Windows — Task Scheduler (schtasks) entry named <winTask>
 *
 * Usage:
 *   import { installSupervision, uninstallSupervision, supervisionStatus } from './supervision.mjs';
 *   await installSupervision();          // embed (default, backward compatible)
 *   await installSupervision('oracle');  // oracle
 *   await uninstallSupervision();
 *   const info = await supervisionStatus();
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { stateDir, doctorRoot } from '../config/xdg.mjs';

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

// Each supervised daemon's identity across the three platform mechanisms,
// plus the CLI invocation the supervisor should keep alive. `embed` stays
// the default service so existing callers of installSupervision() etc. with
// no arguments are unaffected by the generalization.

const SERVICES = {
  embed: {
    launchdLabel: 'com.construct.embed',
    systemdUnit: 'construct-embed.service',
    winTask: 'Construct.Embed',
    description: 'Construct embed daemon',
    args: ['embed', 'start', '--foreground'],
    logFile: 'embed-daemon.log',
  },
  oracle: {
    launchdLabel: 'com.construct.oracle',
    systemdUnit: 'construct-oracle.service',
    winTask: 'Construct.Oracle',
    description: 'Construct oracle daemon',
    args: ['oracle', 'start', '--foreground'],
    logFile: 'oracle-daemon.log',
  },
};

function resolveService(service) {
  const svc = SERVICES[service];
  if (!svc) throw new Error(`supervision: unknown service '${service}' (expected one of: ${Object.keys(SERVICES).join(', ')})`);
  return svc;
}

// ── macOS launchd ───────────────────────────────────────────────────────────

function launchdPlistPath(svc) {
  return path.join(HOME, 'Library', 'LaunchAgents', `${svc.launchdLabel}.plist`);
}

function launchdPlist(svc, bin, logPath) {
  const argStrings = [NODE_BIN, bin, ...svc.args].map((a) => `    <string>${a}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${svc.launchdLabel}</string>
  <key>ProgramArguments</key>
  <array>
${argStrings}
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

async function installLaunchd(svc, bin, logPath) {
  const plistPath = launchdPlistPath(svc);
  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  fs.writeFileSync(plistPath, launchdPlist(svc, bin, logPath));
  const load = spawnSync('launchctl', ['load', '-w', plistPath], { encoding: 'utf8' });
  if (load.status !== 0) {
    throw new Error(`launchctl load failed: ${load.stderr}`);
  }
  return { method: 'launchd', file: plistPath };
}

async function uninstallLaunchd(svc) {
  const plistPath = launchdPlistPath(svc);
  if (!fs.existsSync(plistPath)) return { method: 'launchd', wasInstalled: false };
  spawnSync('launchctl', ['unload', '-w', plistPath], { encoding: 'utf8' });
  fs.rmSync(plistPath, { force: true });
  return { method: 'launchd', wasInstalled: true };
}

function launchdStatus(svc) {
  const plistPath = launchdPlistPath(svc);
  if (!fs.existsSync(plistPath)) return { installed: false };
  const result = spawnSync('launchctl', ['list', svc.launchdLabel], { encoding: 'utf8' });
  return {
    installed: true,
    active: result.status === 0,
    file: plistPath,
  };
}

// ── Linux systemd ───────────────────────────────────────────────────────────

const SYSTEMD_UNIT_DIR = path.join(HOME, '.config', 'systemd', 'user');

function systemdUnitPath(svc) {
  return path.join(SYSTEMD_UNIT_DIR, svc.systemdUnit);
}

function systemdUnit(svc, bin, logPath) {
  return `[Unit]
Description=${svc.description}
After=network.target

[Service]
Type=simple
ExecStart=${NODE_BIN} ${bin} ${svc.args.join(' ')}
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

async function installSystemd(svc, bin, logPath) {
  const unitFile = systemdUnitPath(svc);
  fs.mkdirSync(SYSTEMD_UNIT_DIR, { recursive: true });
  fs.writeFileSync(unitFile, systemdUnit(svc, bin, logPath));

  const reload = spawnSync('systemctl', ['--user', 'daemon-reload'], { encoding: 'utf8' });
  if (reload.status !== 0) throw new Error(`daemon-reload failed: ${reload.stderr}`);

  const enable = spawnSync('systemctl', ['--user', 'enable', '--now', svc.systemdUnit], { encoding: 'utf8' });
  if (enable.status !== 0) throw new Error(`systemctl enable failed: ${enable.stderr}`);

  return { method: 'systemd', file: unitFile };
}

async function uninstallSystemd(svc) {
  const unitFile = systemdUnitPath(svc);
  if (!fs.existsSync(unitFile)) return { method: 'systemd', wasInstalled: false };
  spawnSync('systemctl', ['--user', 'disable', '--now', svc.systemdUnit], { encoding: 'utf8' });
  fs.rmSync(unitFile, { force: true });
  spawnSync('systemctl', ['--user', 'daemon-reload'], { encoding: 'utf8' });
  return { method: 'systemd', wasInstalled: true };
}

function systemdStatus(svc) {
  const unitFile = systemdUnitPath(svc);
  if (!fs.existsSync(unitFile)) return { installed: false };
  const result = spawnSync('systemctl', ['--user', 'is-active', svc.systemdUnit], { encoding: 'utf8' });
  return {
    installed: true,
    active: result.stdout.trim() === 'active',
    file: unitFile,
  };
}

// ── Windows Task Scheduler ──────────────────────────────────────────────────

function windowsTaskCommand(svc, bin, logPath) {
  return [
    'schtasks', '/Create', '/F',
    '/TN', svc.winTask,
    '/TR', `"${NODE_BIN}" "${bin}" ${svc.args.join(' ')} >> "${logPath}" 2>&1`,
    '/SC', 'ONLOGON',
    '/RL', 'HIGHEST',
  ].join(' ');
}

async function installWindows(svc, bin, logPath) {
  const cmd = windowsTaskCommand(svc, bin, logPath);
  const result = spawnSync('cmd', ['/c', cmd], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`schtasks failed: ${result.stderr}`);
  return { method: 'task-scheduler', taskName: svc.winTask };
}

async function uninstallWindows(svc) {
  const result = spawnSync('schtasks', ['/Query', '/TN', svc.winTask], { encoding: 'utf8' });
  if (result.status !== 0) return { method: 'task-scheduler', wasInstalled: false };
  spawnSync('schtasks', ['/Delete', '/TN', svc.winTask, '/F'], { encoding: 'utf8' });
  return { method: 'task-scheduler', wasInstalled: true };
}

function windowsStatus(svc) {
  const result = spawnSync('schtasks', ['/Query', '/TN', svc.winTask, '/FO', 'CSV'], { encoding: 'utf8' });
  if (result.status !== 0) return { installed: false };
  const running = result.stdout.includes('Running');
  return { installed: true, active: running, taskName: svc.winTask };
}

// ── Public API ──────────────────────────────────────────────────────────────

function logPath(svc) {
  return path.join(doctorRoot(), 'runtime', svc.logFile);
}

/**
 * Install the platform supervisor so the daemon auto-restarts on crash.
 *
 * @param {'embed'|'oracle'} [service] - which daemon to supervise (default: embed)
 */
export async function installSupervision(service = 'embed') {
  const svc = resolveService(service);
  const bin = constructBin();
  const log = logPath(svc);
  fs.mkdirSync(path.dirname(log), { recursive: true });

  if (PLATFORM === 'darwin') return installLaunchd(svc, bin, log);
  if (PLATFORM === 'linux')  return installSystemd(svc, bin, log);
  if (PLATFORM === 'win32')  return installWindows(svc, bin, log);
  throw new Error(`supervision not supported on platform: ${PLATFORM}`);
}

/**
 * Remove the platform supervisor entry. Does not stop a currently-running daemon.
 *
 * @param {'embed'|'oracle'} [service] - which daemon to unsupervise (default: embed)
 */
export async function uninstallSupervision(service = 'embed') {
  const svc = resolveService(service);
  if (PLATFORM === 'darwin') return uninstallLaunchd(svc);
  if (PLATFORM === 'linux')  return uninstallSystemd(svc);
  if (PLATFORM === 'win32')  return uninstallWindows(svc);
  throw new Error(`supervision not supported on platform: ${PLATFORM}`);
}

/**
 * Check whether the supervisor is installed and active.
 *
 * @param {'embed'|'oracle'} [service] - which daemon to check (default: embed)
 * @returns {{ installed: boolean, active?: boolean, method?: string, file?: string }}
 */
export function supervisionStatus(service = 'embed') {
  const svc = resolveService(service);
  if (PLATFORM === 'darwin') return { method: 'launchd', ...launchdStatus(svc) };
  if (PLATFORM === 'linux')  return { method: 'systemd', ...systemdStatus(svc) };
  if (PLATFORM === 'win32')  return { method: 'task-scheduler', ...windowsStatus(svc) };
  return { installed: false, method: 'unsupported' };
}

/**
 * Convenience wrappers for the oracle daemon — same mechanism as
 * installSupervision('oracle') etc., named for discoverability.
 */
export async function installOracleSupervision() { return installSupervision('oracle'); }
export async function uninstallOracleSupervision() { return uninstallSupervision('oracle'); }
export function oracleSupervisionStatus() { return supervisionStatus('oracle'); }

/**
 * Exported for tests — the service registry and the three pure template
 * generators, so the generalized per-platform configs can be asserted
 * without spawning launchctl/systemctl/schtasks (no real OS side effects).
 */
export { SERVICES, launchdPlist, systemdUnit, windowsTaskCommand };
