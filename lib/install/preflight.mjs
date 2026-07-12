/**
 * lib/install/preflight.mjs — writability preflight for construct install/setup.
 *
 * runSetup and construct sync mutate several independent host roots (the
 * XDG config/state dirs, each editor's own config directory) with no prior
 * check that any of them are actually writable. A root-owned leftover from
 * an earlier sudo'd install or a read-only mount surfaces as an EACCES
 * thrown mid-sequence, after some roots have already been mutated and
 * before others were reached — neither the old state nor the new one. This
 * probes every target with a real write (mkdir + append + unlink a sidecar
 * file, the same pattern lib/audit-trail.mjs's checkAuditSinkAvailable uses)
 * before runSetup performs its first mutation, so a permission problem is
 * reported — with the exact unwritable path and a chown/chmod remedy — and
 * nothing is touched, rather than discovered halfway through.
 */
import { existsSync, mkdirSync, appendFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { configDir, stateDir } from '../config/xdg.mjs';

function vscodeUserDirs(homeDir) {
  const platform = os.platform();
  if (platform === 'darwin') {
    return [join(homeDir, 'Library', 'Application Support', 'Code', 'User')];
  }
  if (platform === 'linux') {
    return [join(homeDir, '.config', 'Code', 'User')];
  }
  if (platform === 'win32') {
    const appData = process.env.APPDATA ?? join(homeDir, 'AppData', 'Roaming');
    return [join(appData, 'Code', 'User')];
  }
  return [];
}

export function installPreflightTargets(homeDir = os.homedir()) {
  return [
    { label: 'config directory', dir: configDir(homeDir) },
    { label: 'state directory', dir: stateDir(homeDir) },
    { label: 'Claude Code', dir: join(homeDir, '.claude') },
    { label: 'Codex', dir: join(homeDir, '.codex') },
    { label: 'OpenCode', dir: join(homeDir, '.config', 'opencode') },
    { label: 'GitHub Copilot', dir: join(homeDir, '.github') },
    { label: 'Cursor', dir: join(homeDir, '.cursor') },
    ...vscodeUserDirs(homeDir).map((dir) => ({ label: 'VS Code', dir })),
  ];
}

// A real write-probe, not stat/existsSync: a directory can exist and still
// refuse writes (root-owned from a sudo'd install, a read-only remount, a
// quota). Writing and removing a sidecar file physically exercises the same
// path the real mutation will take next.
//
// A preflight that succeeds must not itself be a mutation: if the target
// didn't exist before the probe, remove the directory the probe's own mkdir
// created — otherwise every run conjures empty ~/.codex, ~/.cursor, etc. for
// hosts the user may never actually configure, on a check whose whole point
// is "nothing has been changed yet".

function checkTargetWritable({ dir }) {
  const existedBefore = existsSync(dir);
  const probePath = join(dir, `.construct-install-probe-${process.pid}-${Date.now()}`);
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(probePath, 'probe\n', 'utf8');
    unlinkSync(probePath);
    if (!existedBefore) {
      try { rmdirSync(dir); } catch { /* not empty or already gone — leave it */ }
    }
    return { writable: true, reason: null };
  } catch (err) {
    if (!existedBefore) {
      try { rmdirSync(dir); } catch { /* mkdir may not have succeeded, or dir not empty */ }
    }
    return { writable: false, reason: err?.code || err?.message || 'unknown-error' };
  }
}

export function runInstallPreflight(homeDir = os.homedir()) {
  const results = installPreflightTargets(homeDir).map((target) => ({
    ...target,
    ...checkTargetWritable(target),
  }));
  return { ok: results.every((r) => r.writable), results };
}

export function formatPreflightFailure({ results }) {
  const failed = results.filter((r) => !r.writable);
  const lines = [`Setup cannot write to ${failed.length} target${failed.length === 1 ? '' : 's'} — nothing has been changed:`];
  for (const { label, dir, reason } of failed) {
    lines.push(`  ✗ ${label}: ${dir} (${reason})`);
  }
  if (failed.some((r) => r.reason === 'EACCES')) {
    lines.push('');
    lines.push('EACCES usually means a prior install ran under sudo and left root-owned files behind.');
    lines.push('Fix ownership, then re-run:');
    for (const { dir, reason } of failed) {
      if (reason === 'EACCES') lines.push(`  sudo chown -R "$(id -un)" "${dir}"`);
    }
  }
  return lines.join('\n');
}
