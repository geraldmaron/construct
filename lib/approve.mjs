/**
 * lib/approve.mjs — `construct approve` command + approval-marker library.
 *
 * Enforces an explicit-confirmation contract for mutating git operations:
 * commits, pushes, and PR merges cannot run without an active approval
 * marker written by the user via this command. Markers live at
 * ~/.cx/approvals/<action>.json with an expiry timestamp and remaining
 * count. A PreToolUse:Bash hook (lib/hooks/commit-approval.mjs) reads
 * them and blocks the operation when none is present.
 *
 * Contract:
 *   - Markers carry `createdAt`, `expiresAt`, `remainingCount`, and
 *     optional `reason` + `branch` to scope the approval.
 *   - The hook decrements `remainingCount` on each successful consume;
 *     at zero, the marker is deleted.
 *   - The user (or a specialist that's been given the user's word) is
 *     the only authority that should run `construct approve`. Agents
 *     must not self-approve.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const APPROVAL_DIR = join(homedir(), '.cx', 'approvals');
const DEFAULT_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_COUNT = 1;

export const APPROVABLE_ACTIONS = ['commit', 'push', 'merge'];

function markerPath(action) {
  return join(APPROVAL_DIR, `${action}.json`);
}

function parseDuration(spec) {
  if (!spec) return DEFAULT_DURATION_MS;
  const match = /^(\d+)([smhd])$/i.exec(String(spec).trim());
  if (!match) return DEFAULT_DURATION_MS;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * multipliers[unit];
}

export function readMarker(action) {
  const path = markerPath(action);
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (!data?.expiresAt || new Date(data.expiresAt).getTime() < Date.now()) {
      // Expired — clean up and return null
      try { unlinkSync(path); } catch { /* best effort */ }
      return null;
    }
    if (!Number.isInteger(data.remainingCount) || data.remainingCount <= 0) {
      try { unlinkSync(path); } catch { /* best effort */ }
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function writeMarker(action, { durationMs = DEFAULT_DURATION_MS, count = DEFAULT_COUNT, reason = null, branch = null } = {}) {
  if (!APPROVABLE_ACTIONS.includes(action)) {
    throw new Error(`Unknown approvable action: ${action}. Valid: ${APPROVABLE_ACTIONS.join(', ')}`);
  }
  mkdirSync(APPROVAL_DIR, { recursive: true });
  const now = new Date();
  const data = {
    action,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + durationMs).toISOString(),
    remainingCount: Math.max(1, Number(count) || 1),
    reason: reason || null,
    branch: branch || null,
  };
  writeFileSync(markerPath(action), JSON.stringify(data, null, 2), 'utf8');
  return data;
}

/**
 * Decrements the remaining count on a marker. Deletes the marker when
 * count reaches zero. Called by the hook after the operation is approved.
 */
export function consumeMarker(action) {
  const data = readMarker(action);
  if (!data) return false;
  const remaining = data.remainingCount - 1;
  if (remaining <= 0) {
    try { unlinkSync(markerPath(action)); } catch { /* best effort */ }
  } else {
    writeFileSync(markerPath(action), JSON.stringify({ ...data, remainingCount: remaining }, null, 2), 'utf8');
  }
  return true;
}

export function revokeAll() {
  mkdirSync(APPROVAL_DIR, { recursive: true });
  const entries = readdirSync(APPROVAL_DIR);
  let count = 0;
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      unlinkSync(join(APPROVAL_DIR, entry));
      count += 1;
    } catch { /* best effort */ }
  }
  return count;
}

export function listMarkers() {
  if (!existsSync(APPROVAL_DIR)) return [];
  const entries = readdirSync(APPROVAL_DIR);
  const results = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const action = entry.replace(/\.json$/, '');
    const data = readMarker(action);
    if (data) results.push(data);
  }
  return results;
}

// --- CLI surface ---------------------------------------------------------

function printHelp() {
  console.log(`Usage: construct approve <action> [options]

Writes an explicit approval marker that unblocks the next mutating git
operation. Without a valid marker, the commit-approval hook blocks:
  - git commit
  - git push
  - gh pr merge

Actions:
  commit             Approve the next commit
  push               Approve the next push
  merge              Approve the next PR merge
  status             Show active approvals
  revoke             Clear all pending approvals

Options:
  --duration <spec>  TTL: 10m (default), 30m, 1h, 2d
  --count N          Number of operations to approve (default: 1)
  --reason <text>    Optional reason for audit trail
  --branch <name>    Scope approval to a specific branch
  -h, --help         Show this message

Examples:
  construct approve commit                         # one commit, 10min TTL
  construct approve commit --count 3 --duration 1h # 3 commits within 1h
  construct approve push --branch main             # single push to main
  construct approve status                         # what's active
  construct approve revoke                         # clear everything

Approval is the user's decision. Agents must not run this on their own;
they must ask the user and wait for the user to run it.
`);
}

function formatMarker(m) {
  const remaining = `${Date.parse(m.expiresAt) - Date.now()}ms`;
  const minutes = Math.max(0, Math.round((Date.parse(m.expiresAt) - Date.now()) / 60000));
  return `  ${m.action.padEnd(8)} ${m.remainingCount}x  expires in ${minutes}m  ${m.branch ? `(branch: ${m.branch})` : ''}  ${m.reason || ''}`;
}

export async function runApproveCli(argv = []) {
  const action = argv[0];
  if (!action || action === '--help' || action === '-h') {
    printHelp();
    return;
  }

  if (action === 'status') {
    const markers = listMarkers();
    if (markers.length === 0) {
      console.log('No active approvals.');
      return;
    }
    console.log('Active approvals:');
    markers.forEach((m) => console.log(formatMarker(m)));
    return;
  }

  if (action === 'revoke') {
    const count = revokeAll();
    console.log(`Revoked ${count} approval marker${count === 1 ? '' : 's'}.`);
    return;
  }

  if (!APPROVABLE_ACTIONS.includes(action)) {
    console.error(`Unknown action: ${action}. Valid: ${APPROVABLE_ACTIONS.join(', ')}, status, revoke.`);
    process.exit(1);
  }

  const options = { durationMs: DEFAULT_DURATION_MS, count: DEFAULT_COUNT, reason: null, branch: null };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--duration') options.durationMs = parseDuration(argv[++i]);
    else if (arg.startsWith('--duration=')) options.durationMs = parseDuration(arg.slice(11));
    else if (arg === '--count') options.count = Number(argv[++i]);
    else if (arg.startsWith('--count=')) options.count = Number(arg.slice(8));
    else if (arg === '--reason') options.reason = argv[++i];
    else if (arg.startsWith('--reason=')) options.reason = arg.slice(9);
    else if (arg === '--branch') options.branch = argv[++i];
    else if (arg.startsWith('--branch=')) options.branch = arg.slice(9);
  }

  const marker = writeMarker(action, options);
  const mins = Math.round(options.durationMs / 60000);
  console.log(`✓ Approved ${marker.remainingCount} ${action}${marker.remainingCount === 1 ? '' : 's'} for ${mins} minute${mins === 1 ? '' : 's'}.`);
  if (marker.branch) console.log(`  Scoped to branch: ${marker.branch}`);
  if (marker.reason) console.log(`  Reason: ${marker.reason}`);
  console.log(`  Marker: ${markerPath(action)}`);
}
