/**
 * lib/claude-allow.mjs — read / mutate / audit ~/.claude/settings.json permissions.allow.
 *
 * Claude Code's auto-classifier denies tool calls the user hasn't pre-authorized
 * via `permissions.allow`. Editing that file from within Claude Code is blocked
 * (self-modification of the agent's own permissions). This module is the
 * outside path: Construct's CLI + SessionStart hook use it to surface gaps,
 * propose entries, and apply them atomically.
 *
 * Gap detection is heuristic, not authoritative. We look at recent git
 * branch names and suggest force-push allowlist entries for prefixes the user
 * actually uses but hasn't allowlisted. That's the single biggest source of
 * classifier friction; broader heuristics would be guess-work.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');

const SAFE_PREFIXES = ['feat', 'fix', 'chore', 'docs', 'refactor', 'perf', 'cleanup', 'test', 'build', 'ci', 'style'];
const NEVER_PREFIXES = ['claude', 'agent', 'main', 'master', 'dev'];

function readSettings(path = DEFAULT_SETTINGS_PATH) {
  if (!existsSync(path)) return { exists: false, settings: {}, path };
  try {
    return { exists: true, settings: JSON.parse(readFileSync(path, 'utf8')), path };
  } catch (err) {
    return { exists: true, settings: {}, path, parseError: err.message };
  }
}

function writeSettings(settings, path = DEFAULT_SETTINGS_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const text = `${JSON.stringify(settings, null, 2)}\n`;
  writeFileSync(path, text, 'utf8');
}

export function listAllowEntries({ path = DEFAULT_SETTINGS_PATH } = {}) {
  const { settings } = readSettings(path);
  return Array.isArray(settings?.permissions?.allow) ? [...settings.permissions.allow] : [];
}

/**
 * Add one or more allowlist patterns. Idempotent — duplicates are dropped.
 * Returns { added: string[], existing: string[], total: number }.
 */
export function addAllowEntries(entries, { path = DEFAULT_SETTINGS_PATH } = {}) {
  const incoming = (Array.isArray(entries) ? entries : [entries]).filter((e) => typeof e === 'string' && e.trim());
  const { settings } = readSettings(path);
  if (!settings.permissions) settings.permissions = {};
  if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];

  const existingSet = new Set(settings.permissions.allow);
  const added = [];
  const existing = [];
  for (const entry of incoming) {
    if (existingSet.has(entry)) existing.push(entry);
    else { settings.permissions.allow.push(entry); existingSet.add(entry); added.push(entry); }
  }

  if (added.length > 0) writeSettings(settings, path);
  return { added, existing, total: settings.permissions.allow.length, path };
}

/**
 * Remove patterns. Returns { removed: string[], notFound: string[], total }.
 */
export function removeAllowEntries(entries, { path = DEFAULT_SETTINGS_PATH } = {}) {
  const incoming = (Array.isArray(entries) ? entries : [entries]).filter((e) => typeof e === 'string' && e.trim());
  const { settings } = readSettings(path);
  if (!Array.isArray(settings?.permissions?.allow)) return { removed: [], notFound: incoming, total: 0, path };

  const current = new Set(settings.permissions.allow);
  const removed = [];
  const notFound = [];
  for (const entry of incoming) {
    if (current.has(entry)) { current.delete(entry); removed.push(entry); }
    else notFound.push(entry);
  }

  if (removed.length > 0) {
    settings.permissions.allow = Array.from(current);
    writeSettings(settings, path);
  }
  return { removed, notFound, total: settings.permissions.allow.length, path };
}

/**
 * Scan recent local branches for prefix patterns the user actually uses.
 * Returns the distinct safe prefixes present in the working tree, excluding
 * NEVER_PREFIXES (main/master/dev/claude/agent).
 */
export function detectBranchPrefixes({ cwd = process.cwd(), limit = 200 } = {}) {
  try {
    const out = execSync(`git for-each-ref --count=${limit} --sort=-committerdate --format='%(refname:short)' refs/heads/`, {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    const branches = out.split('\n').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
    const prefixes = new Set();
    for (const b of branches) {
      const idx = b.indexOf('/');
      if (idx <= 0) continue;
      const prefix = b.slice(0, idx);
      if (NEVER_PREFIXES.includes(prefix)) continue;
      if (!SAFE_PREFIXES.includes(prefix)) continue;
      prefixes.add(prefix);
    }
    return Array.from(prefixes).sort();
  } catch { return []; }
}

/**
 * Compare branch prefixes against existing allowlist; return entries the user
 * almost certainly wants but hasn't added. Conservative — only force-push
 * entries, only for prefixes that are SAFE.
 */
export function detectAllowlistGaps({ cwd = process.cwd(), path = DEFAULT_SETTINGS_PATH } = {}) {
  const allow = listAllowEntries({ path });
  const have = new Set(allow);
  const prefixes = detectBranchPrefixes({ cwd });
  const gaps = [];
  for (const prefix of prefixes) {
    const pattern = `Bash(git push --force-with-lease origin ${prefix}/*)`;
    if (!have.has(pattern)) gaps.push({ prefix, pattern });
  }
  return gaps;
}

/**
 * One-line posture string for SessionStart injection. Keeps the surface small:
 * count of current entries + at most 3 suggested gaps. Empty string when
 * nothing to surface so the SessionStart banner stays clean.
 */
export function buildPermissionPostureLine({ cwd = process.cwd(), path = DEFAULT_SETTINGS_PATH } = {}) {
  const allow = listAllowEntries({ path });
  const gaps = detectAllowlistGaps({ cwd, path });
  if (gaps.length === 0) return '';
  const sample = gaps.slice(0, 3).map((g) => g.prefix).join(', ');
  const more = gaps.length > 3 ? ` (+${gaps.length - 3} more)` : '';
  return (
    `\n## Permission posture\n` +
    `Allowlist: ${allow.length} entr${allow.length === 1 ? 'y' : 'ies'} in ${path}.\n` +
    `Suggested gaps: force-push allowlist missing for ${sample}${more}. ` +
    `Close via \`construct claude:allow check --apply\`.\n`
  );
}
