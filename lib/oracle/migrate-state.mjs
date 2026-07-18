/**
 * lib/oracle/migrate-state.mjs — one-time reconcile of retired Oracle overseer
 * state into the surviving owners (construct-b0nny.17, requirement 6).
 *
 * The Oracle background daemon is deleted; its accumulated `.construct/oracle/`
 * state (pending approve-actions, raised-issue fingerprints, per-tick verdicts,
 * routing artifacts) must not be silently dropped (CLAUDE.md rule 2). This
 * reconciler is non-destructive and idempotent: it copies every source artifact
 * verbatim into a durable archive under the E5 workplace-loop state root
 * (resolveStateDir(rootDir, 'workplace-loop', 'oracle-legacy')) and re-homes the
 * load-bearing signal — the latest per-day verdict and every still-pending
 * approve-action — into the surviving overseer's observation memory so the
 * consolidated embed daemon inherits what Oracle knew. A manifest records which
 * observation keys were already emitted, so a re-run reconciles only new state
 * and never double-records. The source directory is left in place: the one-shot
 * `construct oracle review`/`pending` CLI still reads and writes it.
 */

import fs from 'node:fs';
import path from 'node:path';

import { configPath } from '../config-dir.mjs';
import { resolveStateDir } from '../state-root.mjs';
import { addObservation } from '../observation-store.mjs';

const ARCHIVE_SEGMENTS = ['workplace-loop', 'oracle-legacy'];
const MANIFEST_FILE = 'manifest.json';

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

function listDirFiles(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(ext)).sort();
}

function readVerdictLatest(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data.latest ?? data;
  } catch {
    return null;
  }
}

function loadManifest(archiveDir) {
  const file = path.join(archiveDir, MANIFEST_FILE);
  if (!fs.existsSync(file)) return { observedKeys: [] };
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { observedKeys: Array.isArray(data.observedKeys) ? data.observedKeys : [] };
  } catch {
    return { observedKeys: [] };
  }
}

function copyInto(srcFile, destFile) {
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  fs.copyFileSync(srcFile, destFile);
}

/**
 * Reconcile a project's `.construct/oracle/` state into the E5 archive and the
 * survivor observation store.
 *
 * @param {object} opts
 * @param {string} opts.projectDir — project root whose `.construct/oracle/` is read
 * @param {string} [opts.rootDir] — state root for the archive + observation store (default: projectDir)
 * @param {boolean} [opts.dryRun] — compute the plan without writing anything
 * @param {number} [opts.now] — injectable clock for deterministic tests
 * @returns {Promise<{migrated: boolean, dryRun: boolean, reason?: string, source: string, archiveDir: string|null, counts: object, observationsRecorded: number, observationKeys: string[]}>}
 */
export async function migrateOracleState({ projectDir, rootDir = projectDir, dryRun = false, now = Date.now() } = {}) {
  const source = configPath(projectDir, 'oracle');
  const counts = { pending: 0, pendingArchive: 0, raisedIssues: 0, verdictFiles: 0, routingFiles: 0 };

  if (!fs.existsSync(source)) {
    return { migrated: false, dryRun, reason: 'no-oracle-state', source, archiveDir: null, counts, observationsRecorded: 0, observationKeys: [] };
  }

  const pending = readJsonl(path.join(source, 'pending.jsonl'));
  const pendingArchive = readJsonl(path.join(source, 'pending-archive.jsonl'));
  const raisedIssues = readJsonl(path.join(source, 'raised-issues.jsonl'));
  const verdictFiles = listDirFiles(path.join(source, 'verdicts'), '.json');
  const routingFiles = listDirFiles(path.join(source, 'routing'), '.md');

  counts.pending = pending.length;
  counts.pendingArchive = pendingArchive.length;
  counts.raisedIssues = raisedIssues.length;
  counts.verdictFiles = verdictFiles.length;
  counts.routingFiles = routingFiles.length;

  const archiveDir = resolveStateDir(rootDir, ...ARCHIVE_SEGMENTS, { ensureDir: !dryRun });
  const priorKeys = new Set(loadManifest(archiveDir).observedKeys);

  const openPending = pending.filter((p) => p.status === 'pending');
  const verdicts = verdictFiles
    .map((f) => ({ date: f.replace(/\.json$/, ''), latest: readVerdictLatest(path.join(source, 'verdicts', f)) }))
    .filter((v) => v.latest);

  const planned = [];
  for (const v of verdicts) {
    const key = `verdict:${v.date}`;
    if (!priorKeys.has(key)) planned.push({ key, kind: 'verdict', date: v.date, latest: v.latest });
  }
  for (const p of openPending) {
    const key = `pending:${p.id ?? p.dedupKey ?? p.kind}`;
    if (!priorKeys.has(key)) planned.push({ key, kind: 'pending', row: p });
  }

  if (dryRun) {
    return {
      migrated: true,
      dryRun: true,
      source,
      archiveDir,
      counts,
      observationsRecorded: planned.length,
      observationKeys: planned.map((x) => x.key),
    };
  }

  const copyPairs = [
    [path.join(source, 'pending.jsonl'), path.join(archiveDir, 'pending.jsonl')],
    [path.join(source, 'pending-archive.jsonl'), path.join(archiveDir, 'pending-archive.jsonl')],
    [path.join(source, 'raised-issues.jsonl'), path.join(archiveDir, 'raised-issues.jsonl')],
  ];
  for (const [src, dest] of copyPairs) {
    if (fs.existsSync(src)) copyInto(src, dest);
  }
  for (const f of verdictFiles) copyInto(path.join(source, 'verdicts', f), path.join(archiveDir, 'verdicts', f));
  for (const f of routingFiles) copyInto(path.join(source, 'routing', f), path.join(archiveDir, 'routing', f));

  const recordedKeys = [];
  for (const item of planned) {
    if (item.kind === 'verdict') {
      const verdict = item.latest.verdict ?? 'unknown';
      const gaps = item.latest.gaps ?? [];
      await addObservation(rootDir, {
        role: 'construct',
        category: verdict === 'healthy' ? 'insight' : 'anti-pattern',
        summary: `[oracle-migration] verdict ${item.date}: ${verdict} (${gaps.length} gap(s))`,
        content: JSON.stringify({ date: item.date, verdict, gaps }, null, 2),
        tags: ['oracle-migration', 'verdict', item.date],
        confidence: 0.85,
        source: 'oracle-state-migration',
      });
    } else {
      const row = item.row;
      await addObservation(rootDir, {
        role: 'construct',
        category: 'decision',
        summary: `[oracle-migration] pending ${row.kind ?? 'action'}: ${String(row.summary ?? row.detail ?? row.id ?? '').slice(0, 160)}`,
        content: JSON.stringify(row, null, 2),
        tags: ['oracle-migration', 'pending', String(row.id ?? row.dedupKey ?? row.kind ?? 'unknown')],
        confidence: 0.85,
        source: 'oracle-state-migration',
      });
    }
    recordedKeys.push(item.key);
  }

  const manifest = {
    migratedAt: new Date(now).toISOString(),
    source,
    counts,
    observedKeys: [...priorKeys, ...recordedKeys],
  };
  fs.writeFileSync(path.join(archiveDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  return {
    migrated: true,
    dryRun: false,
    source,
    archiveDir,
    counts,
    observationsRecorded: recordedKeys.length,
    observationKeys: recordedKeys,
  };
}
