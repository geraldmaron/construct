/**
 * lib/artifact-capture.mjs — Automatic observation capture from session artifacts.
 *
 * At session end, extracts meaningful observations from the distilled session
 * record and git state. Auto-populates the observation store so specialists
 * build institutional memory over time.
 *
 * Invoked from stop-notify.mjs — best-effort, non-blocking.
 */
import { execSync } from 'node:child_process';
import { basename } from 'node:path';
import { addObservation } from './observation-store.mjs';
import { createEntity, addRelatedEntity } from './entity-store.mjs';

const MAX_DECISION_OBS = 5;
const MAX_FILE_PATTERNS = 10;

/**
 * Capture observations from a completed session record.
 * Returns the list of created observation IDs.
 */
export async function captureSessionArtifacts(rootDir, session) {
  if (!session) return [];
  const ids = [];
  const project = session.project || basename(rootDir);

  // Resolve current HEAD SHA for observation provenance (best effort)
  let gitSha = null;
  try {
    gitSha = execSync(`git -C "${rootDir}" rev-parse HEAD 2>/dev/null`, { timeout: 3000 }).toString().trim().slice(0, 40) || null;
  } catch { /* not a git repo */ }

  // Only record a session-summary observation when the content is meaningful.
  // Trivially short summaries (≤25 chars) or known placeholder patterns are skipped
  // to prevent the observation store filling with noise like "IMPLEMENT: done".
  const PLACEHOLDER_RE = /^(implement|done|completed|session completed|in_progress)[\s:.]*(done|ok|completed)?$/i;
  if (session.summary && session.summary.length > 10 && !PLACEHOLDER_RE.test(session.summary.trim())) {
    const obs = await addObservation(rootDir, {
      role: 'construct',
      category: 'session-summary',
      summary: session.summary,
      content: buildSessionContent(session),
      tags: [project, 'session'],
      project,
      confidence: 0.9,
      source: { session: session.id },
      gitSha,
    });
    if (obs) ids.push(obs.id);
  }

  if (session.decisions?.length) {
    for (const decision of session.decisions.slice(0, MAX_DECISION_OBS)) {
      const obs = await addObservation(rootDir, {
        role: 'construct',
        category: 'decision',
        summary: decision,
        content: decision,
        tags: [project, 'decision'],
        project,
        confidence: 0.85,
        source: { session: session.id },
        gitSha,
      });
      if (obs) ids.push(obs.id);
    }
  }

  if (session.filesChanged?.length) {
    const patterns = extractFilePatterns(session.filesChanged);
    for (const pattern of patterns.slice(0, MAX_FILE_PATTERNS)) {
      createEntity(rootDir, {
        name: pattern.name,
        type: 'file-group',
        summary: pattern.summary,
        project,
        observationIds: ids,
      });
    }
  }

  return ids;
}

/**
 * Analyze git log for co-change patterns and record as entity relationships.
 * Runs git commands — returns empty on failure.
 */
export function captureDependencyPatterns(rootDir) {
  const coChanges = new Map();

  try {
    const commits = execSync(
      `git -C "${rootDir}" log --format='%H' -20 2>/dev/null`,
      { timeout: 10000 },
    ).toString().trim().split('\n').filter(Boolean);

    for (const sha of commits) {
      try {
        const files = execSync(
          `git -C "${rootDir}" diff-tree --no-commit-id --name-only -r ${sha} 2>/dev/null`,
          { timeout: 5000 },
        ).toString().trim().split('\n').filter(Boolean);

        const dirs = [...new Set(files.map((f) => f.split('/').slice(0, 2).join('/')))];
        for (let i = 0; i < dirs.length; i++) {
          for (let j = i + 1; j < dirs.length; j++) {
            const key = [dirs[i], dirs[j]].sort().join('↔');
            coChanges.set(key, (coChanges.get(key) || 0) + 1);
          }
        }
      } catch { /* individual commit failure is fine */ }
    }
  } catch { /* git not available or not a repo */ }

  const relationships = [];
  for (const [key, count] of coChanges) {
    if (count >= 3) {
      const [a, b] = key.split('↔');
      relationships.push({ a, b, count });

      createEntity(rootDir, {
        name: a,
        type: 'file-group',
        summary: `Directory group: ${a}`,
        project: basename(rootDir),
      });
      createEntity(rootDir, {
        name: b,
        type: 'file-group',
        summary: `Directory group: ${b}`,
        project: basename(rootDir),
      });
      addRelatedEntity(rootDir, a, b);
    }
  }

  return relationships;
}

function buildSessionContent(session) {
  const parts = [];
  if (session.summary) parts.push(session.summary);

  if (session.decisions?.length) {
    parts.push('Decisions: ' + session.decisions.join('; '));
  }

  if (session.filesChanged?.length) {
    const files = session.filesChanged
      .slice(0, 10)
      .map((f) => `${f.path} (${f.reason || 'modified'})`)
      .join(', ');
    parts.push('Files: ' + files);
  }

  if (session.openQuestions?.length) {
    parts.push('Open: ' + session.openQuestions.join('; '));
  }

  return parts.join('\n');
}

function extractFilePatterns(filesChanged) {
  const dirCounts = new Map();
  for (const file of filesChanged) {
    const dir = String(file.path || '').split('/').slice(0, 2).join('/');
    if (dir) {
      const entry = dirCounts.get(dir) || { count: 0, reasons: new Set() };
      entry.count += 1;
      if (file.reason) entry.reasons.add(file.reason);
      dirCounts.set(dir, entry);
    }
  }

  return [...dirCounts]
    .filter(([, v]) => v.count >= 2)
    .sort(([, a], [, b]) => b.count - a.count)
    .map(([dir, v]) => ({
      name: dir,
      summary: `${v.count} files changed: ${[...v.reasons].slice(0, 3).join(', ') || 'various changes'}`,
    }));
}
