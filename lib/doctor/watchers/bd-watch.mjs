/**
 * lib/doctor/watchers/bd-watch.mjs — periodic bd state poller for handoffs.
 *
 * Every 5 min, polls bd for open issues labeled `next:cx-<role>` where the
 * target persona is onboarded in the role framework. Newly-seen issues are
 * enqueued as pending invocations so session-start surfaces them to
 * Construct. Seen issues are remembered in ~/.cx/bd-watch-seen.json to
 * prevent re-emission while the label remains.
 *
 * Closes a gap in agent-tracker: agent-tracker only catches handoffs that
 * appear in Task result text. bd-watch catches every handoff that exists
 * as a label, regardless of how it got there (manual, ai, automated).
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { record } from '../audit.mjs';
import { listOnboardedPersonas, loadManifest } from '../../roles/manifest.mjs';

export const name = 'bd-watch';
export const intervalMs = 5 * 60 * 1000;

const SEEN_PATH = join(homedir(), '.cx', 'bd-watch-seen.json');
const PENDING_PATH = join(homedir(), '.cx', 'role-pending.jsonl');

function ensureDir() {
  const dir = join(homedir(), '.cx');
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
  const onboarded = listOnboardedPersonas();
  let totalIssues = 0;
  let newQueued = 0;

  for (const personaId of onboarded) {
    const label = `next:cx-${personaId}`;
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
      const manifest = loadManifest(personaId);
      const entry = {
        ts: Date.now(),
        personaId,
        cxId: `cx-${personaId}`,
        bdIssueId: issue.id,
        fingerprint: `bd-handoff-${issue.id}-${personaId}`,
        eventType: 'handoff.received',
        summary: `bd ${issue.id} labeled next:cx-${personaId} — ${(issue.title || '').slice(0, 120)}`,
        killSwitchEnv: manifest?.killSwitchEnv || '',
        source: 'bd-watch',
      };
      appendFileSync(PENDING_PATH, JSON.stringify(entry) + '\n');
      record({
        kind: 'action',
        watcher: name,
        action: 'queue-handoff',
        target: `cx-${personaId}`,
        summary: `queued ${issue.id} for cx-${personaId}`,
        context: { bdIssueId: issue.id, label, title: issue.title },
      });
      actions.push({ type: 'queue-handoff', target: `cx-${personaId}`, bdIssueId: issue.id });
      newQueued++;
    }
  }

  saveSeen(seen);
  notes.push({ personasChecked: onboarded.length, totalIssues, newQueued });
  return { actions, escalations: [], notes };
}
