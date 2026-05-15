/**
 * lib/overrides/resolver.mjs — single override + backup helper for every
 * user-customizable Construct primitive (personas, skills, rules,
 * contracts, role manifests).
 *
 * Convention:
 *   - Original lives in the install (`personas/<n>.md`, `skills/.../<n>.md`, …)
 *   - User override lives at `.cx/<category>/<n>.<ext>` — gitignored
 *   - Each edit snapshots the prior content to
 *     `.cx/backups/<category>/<n>.<iso>.<ext>` — gitignored, 60-day
 *     auto-prune
 *
 * Override semantics: full file replacement (decided 2026-05-14). No
 * section-merge. Means sync() reads the override file verbatim if
 * present; otherwise reads the original.
 *
 * Backups: each call to `applyEdit` writes the prior content (if any)
 * to `.cx/backups/<category>/<n>.<iso>.<ext>` before the new content
 * lands. `restoreFromBackup` is the inverse.
 *
 * `pruneBackups(maxDays=60)` deletes backup files older than the cap.
 * Idempotent — safe to call from a cron, post-merge hook, or doctor
 * --fix.
 */
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_BACKUP_MAX_DAYS = 60;

export const SUPPORTED_CATEGORIES = Object.freeze([
  'personas',
  'agents',
  'skills',
  'rules',
  'contracts',
  'role-manifests',
]);

const CATEGORY_RULES = {
  personas: { originalDir: 'personas', defaultExt: '.md' },
  agents: { originalDir: 'agents/prompts', defaultExt: '.md' },
  skills: { originalDir: 'skills', defaultExt: '.md' },
  rules: { originalDir: 'rules', defaultExt: '.md' },
  contracts: { originalDir: 'agents', defaultExt: '.json', singleFile: 'contracts.json' },
  'role-manifests': { originalDir: 'agents', defaultExt: '.json', singleFile: 'role-manifests.json' },
};

function categoryRule(category) {
  const rule = CATEGORY_RULES[category];
  if (!rule) throw new Error(`unknown override category: ${category}`);
  return rule;
}

function isoStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function ensureCxIgnore(projectRoot) {
  const cxDir = path.join(projectRoot, '.cx');
  fs.mkdirSync(cxDir, { recursive: true });
  const gitignorePath = path.join(cxDir, '.gitignore');
  const want = 'backups/\n';
  let existing = '';
  try { existing = fs.readFileSync(gitignorePath, 'utf8'); } catch { /* fresh */ }
  if (!existing.split(/\r?\n/).map((l) => l.trim()).includes('backups/')) {
    fs.writeFileSync(gitignorePath, existing + (existing.endsWith('\n') || !existing ? '' : '\n') + want);
  }
}

function originalPath(projectRoot, category, name) {
  const rule = categoryRule(category);
  if (rule.singleFile) {
    return path.join(projectRoot, rule.originalDir, rule.singleFile);
  }
  const ext = name.includes('.') ? '' : rule.defaultExt;
  return path.join(projectRoot, rule.originalDir, `${name}${ext}`);
}

function overridePath(projectRoot, category, name) {
  const rule = categoryRule(category);
  if (rule.singleFile) {
    return path.join(projectRoot, '.cx', category, rule.singleFile);
  }
  const ext = name.includes('.') ? '' : rule.defaultExt;
  return path.join(projectRoot, '.cx', category, `${name}${ext}`);
}

function backupDir(projectRoot, category) {
  return path.join(projectRoot, '.cx', 'backups', category);
}

function backupName(name, ext) {
  return `${name}.${isoStamp()}${ext}`;
}

function readIfExists(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return null; }
}

export function resolveOverride(projectRoot, category, name) {
  const orig = originalPath(projectRoot, category, name);
  const over = overridePath(projectRoot, category, name);
  if (fs.existsSync(over)) {
    return { path: over, source: 'override', overrideExists: true, originalPath: orig };
  }
  if (fs.existsSync(orig)) {
    return { path: orig, source: 'original', overrideExists: false, originalPath: orig };
  }
  return { path: null, source: 'missing', overrideExists: false, originalPath: orig };
}

export function readResolved(projectRoot, category, name) {
  const r = resolveOverride(projectRoot, category, name);
  if (!r.path) return { content: null, source: 'missing' };
  return { content: readIfExists(r.path), source: r.source };
}

export function applyEdit(projectRoot, category, name, newContent) {
  if (typeof newContent !== 'string') throw new Error('newContent must be a string');
  const over = overridePath(projectRoot, category, name);
  const rule = categoryRule(category);
  const ext = name.includes('.') ? path.extname(name) : rule.defaultExt;
  ensureCxIgnore(projectRoot);
  fs.mkdirSync(path.dirname(over), { recursive: true });

  const priorContent = fs.existsSync(over)
    ? readIfExists(over)
    : readIfExists(originalPath(projectRoot, category, name));

  let backupPath = null;
  if (priorContent !== null && priorContent !== newContent) {
    const dir = backupDir(projectRoot, category);
    fs.mkdirSync(dir, { recursive: true });
    backupPath = path.join(dir, backupName(name, ext));
    fs.writeFileSync(backupPath, priorContent);
  }

  fs.writeFileSync(over, newContent);
  return { overridePath: over, backupPath, wrote: newContent.length };
}

export function listBackups(projectRoot, category, name) {
  const dir = backupDir(projectRoot, category);
  if (!fs.existsSync(dir)) return [];
  const prefix = `${name}.`;
  const entries = fs.readdirSync(dir)
    .filter((f) => f.startsWith(prefix))
    .map((f) => {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      return { filename: f, path: full, mtimeMs: stat.mtimeMs, size: stat.size };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return entries;
}

export function restoreFromBackup(projectRoot, category, name, backupFilename) {
  const dir = backupDir(projectRoot, category);
  const src = path.join(dir, backupFilename);
  if (!fs.existsSync(src)) throw new Error(`backup not found: ${src}`);
  const content = fs.readFileSync(src, 'utf8');
  return applyEdit(projectRoot, category, name, content);
}

export function pruneBackups(projectRoot, { maxDays = DEFAULT_BACKUP_MAX_DAYS, now = Date.now() } = {}) {
  const root = path.join(projectRoot, '.cx', 'backups');
  if (!fs.existsSync(root)) return { pruned: [], kept: 0 };
  const cutoff = now - maxDays * 24 * 60 * 60 * 1000;
  const pruned = [];
  let kept = 0;
  for (const category of fs.readdirSync(root)) {
    const dir = path.join(root, category);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      const stat = fs.statSync(full);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(full);
        pruned.push(full);
      } else {
        kept += 1;
      }
    }
  }
  return { pruned, kept };
}

export function describeOverrides(projectRoot) {
  const summary = {};
  for (const category of SUPPORTED_CATEGORIES) {
    const dir = path.join(projectRoot, '.cx', category);
    if (!fs.existsSync(dir)) { summary[category] = []; continue; }
    const entries = [];
    const walk = (rel = '') => {
      const cur = path.join(dir, rel);
      for (const name of fs.readdirSync(cur)) {
        const full = path.join(cur, name);
        const relPath = path.join(rel, name);
        if (fs.statSync(full).isDirectory()) { walk(relPath); continue; }
        entries.push(relPath);
      }
    };
    walk();
    summary[category] = entries;
  }
  return summary;
}
