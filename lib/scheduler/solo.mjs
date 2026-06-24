/**
 * lib/scheduler/solo.mjs — native platform trigger management for solo deployment mode.
 *
 * Detects the current platform (darwin/linux/win32) and writes the appropriate
 * trigger file so the OS scheduler runs the job without a long-lived Construct
 * daemon.
 *
 * darwin  — launchd plist at ~/Library/LaunchAgents/com.construct.job.<id>.plist
 * linux   — systemd timer unit at ~/.config/systemd/user/construct-<id>.timer
 *           (plus a matching .service unit at the same path)
 * win32   — no-op with a descriptive message (Task Scheduler XML generation
 *           is deferred; Windows support is tracked separately)
 *
 * The schedule parameter is a cron expression (5-field).
 * launchd uses StartCalendarInterval derived from the cron fields.
 * systemd uses OnCalendar= translated from the cron expression.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { doctorRoot } from '../config/xdg.mjs';

// ---------------------------------------------------------------------------
// Cron parsing helpers — minimal support for standard 5-field cron
// ---------------------------------------------------------------------------

function parseCron(schedule) {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`unsupported cron expression (need 5 fields): ${schedule}`);
  const [minute, hour, dom, month, dow] = parts;
  return { minute, hour, dom, month, dow };
}

function cronToLaunchdCalendar(schedule) {
  const { minute, hour, dom, month, dow } = parseCron(schedule);
  const items = [];
  if (minute !== '*') items.push(`        <key>Minute</key><integer>${minute}</integer>`);
  if (hour !== '*') items.push(`        <key>Hour</key><integer>${hour}</integer>`);
  if (dom !== '*') items.push(`        <key>Day</key><integer>${dom}</integer>`);
  if (month !== '*') items.push(`        <key>Month</key><integer>${month}</integer>`);
  if (dow !== '*') items.push(`        <key>Weekday</key><integer>${dow}</integer>`);
  return items.join('\n');
}

function cronToSystemdOnCalendar(schedule) {
  const { minute, hour, dom, month, dow } = parseCron(schedule);
  const dayOfWeek = dow === '*' ? '*' : dow;
  const d = dom === '*' ? '*' : dom;
  const m = month === '*' ? '*' : `*-${month}`;
  const time = `${hour === '*' ? '*' : hour.padStart(2,'0')}:${minute === '*' ? '*' : minute.padStart(2,'0')}:00`;
  return `${dayOfWeek} ${m}-${d} ${time}`;
}

// ---------------------------------------------------------------------------
// Platform-specific trigger writers
// ---------------------------------------------------------------------------

function writeLaunchdPlist(id, schedule, cwd) {
  const label = `com.construct.job.${id}`;
  const plistDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  const plistPath = path.join(plistDir, `${label}.plist`);
  const constructBin = path.join(cwd, 'bin', 'construct');
  const calendarEntries = cronToLaunchdCalendar(schedule);

  const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${constructBin}</string>
        <string>scheduler</string>
        <string>run</string>
        <string>${id}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${cwd}</string>
    <key>StartCalendarInterval</key>
    <dict>
${calendarEntries}
    </dict>
    <key>StandardOutPath</key>
    <string>${path.join(doctorRoot(), 'scheduler', 'logs', `${id}.stdout.log`)}</string>
    <key>StandardErrorPath</key>
    <string>${path.join(doctorRoot(), 'scheduler', 'logs', `${id}.stderr.log`)}</string>
    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>
`;
  fs.mkdirSync(plistDir, { recursive: true });
  fs.writeFileSync(plistPath, content, 'utf8');
  return plistPath;
}

function writeSystemdUnits(id, schedule, cwd) {
  const unitDir = path.join(os.homedir(), '.config', 'systemd', 'user');
  const timerPath = path.join(unitDir, `construct-${id}.timer`);
  const servicePath = path.join(unitDir, `construct-${id}.service`);
  const constructBin = path.join(cwd, 'bin', 'construct');
  const onCalendar = cronToSystemdOnCalendar(schedule);

  const timerContent = `[Unit]
Description=Construct job scheduler: ${id}

[Timer]
OnCalendar=${onCalendar}
Persistent=true

[Install]
WantedBy=timers.target
`;

  const serviceContent = `[Unit]
Description=Construct job: ${id}

[Service]
Type=oneshot
WorkingDirectory=${cwd}
ExecStart=${constructBin} scheduler run ${id}
StandardOutput=append:${path.join(doctorRoot(), 'scheduler', 'logs', `${id}.stdout.log`)}
StandardError=append:${path.join(doctorRoot(), 'scheduler', 'logs', `${id}.stderr.log`)}
`;

  fs.mkdirSync(unitDir, { recursive: true });
  fs.writeFileSync(timerPath, timerContent, 'utf8');
  fs.writeFileSync(servicePath, serviceContent, 'utf8');
  return timerPath;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detects the current platform and writes the appropriate native trigger file.
 * Returns { platform, triggerPath, installed: boolean }.
 *
 * On win32, installed is false and triggerPath is null (deferred support).
 */
export function registerNativeTrigger({ id, schedule, cwd = process.cwd() }) {
  const platform = process.platform;

  if (platform === 'darwin') {
    const triggerPath = writeLaunchdPlist(id, schedule, cwd);
    return { platform, triggerPath, installed: true };
  }

  if (platform === 'linux') {
    const triggerPath = writeSystemdUnits(id, schedule, cwd);
    return { platform, triggerPath, installed: true };
  }

  return { platform, triggerPath: null, installed: false };
}

/**
 * Removes the native trigger file(s) for the given job id.
 * Silently ignores missing files.
 */
export function removeNativeTrigger({ id }) {
  const platform = process.platform;

  if (platform === 'darwin') {
    const label = `com.construct.job.${id}`;
    const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
    if (fs.existsSync(plistPath)) fs.unlinkSync(plistPath);
    return { platform, removed: plistPath };
  }

  if (platform === 'linux') {
    const unitDir = path.join(os.homedir(), '.config', 'systemd', 'user');
    const timerPath = path.join(unitDir, `construct-${id}.timer`);
    const servicePath = path.join(unitDir, `construct-${id}.service`);
    if (fs.existsSync(timerPath)) fs.unlinkSync(timerPath);
    if (fs.existsSync(servicePath)) fs.unlinkSync(servicePath);
    return { platform, removed: timerPath };
  }

  return { platform, removed: null };
}
