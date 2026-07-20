/**
 * lib/doctor/watchers/bd-watch.mjs — periodic bd state poller for handoffs.
 *
 * Every 5 min, polls bd for open issues labeled `next:cx-<role>` where the
 * target worker profile is onboarded in the role framework. Newly-seen issues are
 * enqueued as pending invocations so session-start surfaces them to
 * Construct. Seen issues are remembered in <doctorRoot>/bd-watch-seen.json to
 * prevent re-emission while the label remains.
 *
 * Closes a gap in agent-tracker: agent-tracker only catches handoffs that
 * appear in Task result text. bd-watch catches every handoff that exists
 * as a label, regardless of how it got there (manual, ai, automated).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { appendBounded } from '../../logging/rotate.mjs';
import { resolveProjectScope } from '../../project-root.mjs';
import { join } from 'node:path';

import { record } from '../audit.mjs';
import { listOnboardedWorkerProfiles, loadManifest } from '../../roles/manifest.mjs';
import { doctorRoot } from '../../config/xdg.mjs';

export const name = 'bd-watch';
export const intervalMs = 5 * 60 * 1000;

const SEEN_PATH = join(doctorRoot(), 'bd-watch-seen.json');
const PENDING_PATH = join(doctorRoot(), 'role-pending.jsonl');

function ensureDir() {
  const dir = doctorRoot();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadSeen() {
  if (!existsSync(SEEN_PATH)) return {};
  try { return JSON.parse(readFileSync(SEEN_PATH, 'utf8')); } catch { return {}; }
}
function saveSeen(state) {
  ensureDir();
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const trimmed = {};
  for (const [k, v] of Object.entries(state)) {
    if ((v?.ts || 0) > cutoff) trimmed[k] = v;
  }
  writeFileSync(SEEN_PATH, JSON.stringify(trimmed));
}

function listByLabel(label) {
  const r = spawnSync('bd', ['list', '-l', label, '--status', 'open', '--json'], {
    encoding: 'utf8',
    timeout: 8000,
  });
  if (r.status !== 0) return { ok: false, error: r.stderr || `bd exit ${r.status}` };
  try {
    const parsed = JSON.parse(r.stdout || '[]');
    return { ok: true, issues: Array.isArray(parsed) ? parsed : [] };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function tick() {
  const actions = [];
  const notes = [];
  const seen = loadSeen();
  const onboarded = listOnboardedWorkerProfiles();
  let totalIssues = 0;
  let newQueued = 0;

  for (const workerProfileId of onboarded) {
    const label = `next:${workerProfileId}`;
    const result = listByLabel(label);
    if (!result.ok) {
      record({
        kind: 'error',
        watcher: name,
        target: label,
        result: 'failed',
        summary: `bd list -l ${label} failed: ${result.error}`,
      });
      continue;
    }
    totalIssues += result.issues.length;
    for (const issue of result.issues) {
      const key = `${issue.id}|${label}`;
      if (seen[key]) continue;
      seen[key] = { ts: Date.now(), id: issue.id };
      const manifest = loadManifest(workerProfileId);
      const scope = resolveProjectScope();
      const entry = {
        ts: Date.now(),
        workerProfileId,
        workerProfileId: `${workerProfileId}`,
        bdIssueId: issue.id,
        fingerprint: `bd-handoff-${issue.id}-${workerProfileId}`,
        eventType: 'handoff.received',
        summary: `bd ${issue.id} labeled next:${workerProfileId} — ${(issue.title || '').slice(0, 120)}`,
        killSwitchEnv: manifest?.killSwitchEnv || '',
        source: 'bd-watch',
        ...(scope?.projectId ? { projectId: scope.projectId } : {}),
      };
      appendBounded('role-pending', PENDING_PATH, JSON.stringify(entry) + '\n');
      record({
        kind: 'action',
        watcher: name,
        action: 'queue-handoff',
        target: `${workerProfileId}`,
        summary: `queued ${issue.id} for ${workerProfileId}`,
        context: { bdIssueId: issue.id, label, title: issue.title },
      });
      actions.push({ type: 'queue-handoff', target: `${workerProfileId}`, bdIssueId: issue.id });
      newQueued++;
    }
  }

  saveSeen(seen);
  notes.push({ workerProfilesChecked: onboarded.length, totalIssues, newQueued });
  return { actions, escalations: [], notes };
}
