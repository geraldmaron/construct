/**
 * lib/init/detect-existing-structure.mjs — Inspect a project for content
 * directories, custom intake surfaces, and root template files so init/sync
 * can defer to what's already there instead of scaffolding parallel trees.
 *
 * Returns a deterministic shape:
 *   {
 *     existingLanes: { <laneKey>: [{ path, markdownCount }, ...] },
 *     customIntake: { ingestScript: string|null, intakePaths: string[] },
 *     rootTemplates: { dir: string|null, files: string[] }
 *   }
 *
 * Heuristics intentionally err on the side of "skip" — a directory is treated
 * as a real lane only when it carries at least one markdown file. An empty
 * docs/notes/meetings/ that an earlier init scaffolded does NOT register; that lets
 * re-running init be a no-op rather than a contradictory "skip what we just
 * created" message.
 *
 * Issue #97 motivates this: `construct init` on an existing project with
 * `internal/meetings/`, a custom `ingest` script, and root-level `templates/`
 * created `docs/notes/meetings/`, `inbox/`, and per-lane `templates/` folders
 * that conflicted with the existing workflow.
 */

import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_MARKERS } from '../config-dir.mjs';

// Matches the LANE_ALIASES table in lib/init-docs.mjs / lib/init-unified.mjs.
// Keep in sync if those grow new entries. The detector only needs alias →
// lane mapping for directory-name matching; the full lane metadata lives in
// the init modules that consume the result.

export const LANE_DIR_ALIASES = {
  adr: 'adrs',
  adrs: 'adrs',
  brief: 'briefs',
  briefs: 'briefs',
  changelog: 'changelogs',
  changelogs: 'changelogs',
  release: 'changelogs',
  releases: 'changelogs',
  intake: 'intake',
  inbox: 'intake',
  memo: 'memos',
  memos: 'memos',
  meeting: 'meetings',
  meetings: 'meetings',
  minutes: 'meetings',
  retro: 'meetings',
  retros: 'meetings',
  note: 'notes',
  notes: 'notes',
  onboard: 'onboarding',
  onboarding: 'onboarding',
  postmortem: 'postmortems',
  postmortems: 'postmortems',
  incident: 'postmortems',
  incidents: 'postmortems',
  prd: 'prds',
  prds: 'prds',
  rfc: 'rfcs',
  rfcs: 'rfcs',
  runbook: 'runbooks',
  runbooks: 'runbooks',
};

// Skip these top-level directories when scanning. Generated, vendored, or
// already-Construct-managed trees never carry user content lanes.

const SCAN_SKIP_DIRS = new Set([
  '.git',
  ...PROJECT_MARKERS,
  '.beads',
  '.claude',
  '.codex',
  '.cursor',
  '.vscode',
  '.github',
  '.husky',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'target',
  '.next',
  '.cache',
  '.pnpm-store',
  '.venv',
  'venv',
  '__pycache__',
]);

const MAX_SCAN_DEPTH = 3;

// Common custom intake-script names. Project owners who hand-roll an ingest
// path overwhelmingly name it one of these. Each is checked at repo root.

const INTAKE_SCRIPT_CANDIDATES = ['ingest', 'ingest.sh', 'ingest.mjs', 'ingest.js', 'ingest.py'];

// Common custom raw-intake directory shapes seen in real projects (issue #97
// repro had data/customers/notes/raw/). Glob-free literal paths so detection
// stays cheap and predictable.

const INTAKE_PATH_CANDIDATES = [
  'data/customers/notes/raw',
  'data/intake',
  'data/raw',
  'ingestion',
  'intake-pipeline',
  'raw',
];

function countMarkdownFiles(dir) {
  let count = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.mdx'))) count++;
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        count += countMarkdownFiles(path.join(dir, entry.name));
      }
      if (count >= 100) break;
    }
  } catch { /* unreadable dir is treated as empty */ }
  return count;
}

function walkLaneDirs(rootDir, currentDir, depth, accumulator) {
  if (depth > MAX_SCAN_DEPTH) return;
  let entries = [];
  try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SCAN_SKIP_DIRS.has(entry.name)) continue;
    const absPath = path.join(currentDir, entry.name);
    const relPath = path.relative(rootDir, absPath);
    const lower = entry.name.toLowerCase();
    const laneKey = LANE_DIR_ALIASES[lower];
    if (laneKey) {
      // The newly-scaffolded docs/<lane>/ tree is what init writes, so it
      // doesn't count as "existing" content. Other locations do.
      const isOwnDocsTree = relPath === path.join('docs', LANE_DIR_ALIASES[lower]) || relPath === path.join('docs', lower);
      if (!isOwnDocsTree) {
        const markdownCount = countMarkdownFiles(absPath);
        if (markdownCount > 0) {
          if (!accumulator[laneKey]) accumulator[laneKey] = [];
          accumulator[laneKey].push({ path: relPath, markdownCount });
        }
      }
    }
    walkLaneDirs(rootDir, absPath, depth + 1, accumulator);
  }
}

function detectIntakeScript(rootDir) {
  for (const candidate of INTAKE_SCRIPT_CANDIDATES) {
    const candidatePath = path.join(rootDir, candidate);
    if (!fs.existsSync(candidatePath)) continue;
    try {
      const stat = fs.statSync(candidatePath);
      if (stat.isFile()) return candidate;
    } catch { /* race with deletion — treat as absent */ }
  }
  return null;
}

function detectIntakePaths(rootDir) {
  const found = [];
  for (const rel of INTAKE_PATH_CANDIDATES) {
    const abs = path.join(rootDir, rel);
    if (fs.existsSync(abs)) found.push(rel);
  }
  return found;
}

function detectRootTemplates(rootDir) {
  const templatesDir = path.join(rootDir, 'templates');
  if (!fs.existsSync(templatesDir)) return { dir: null, files: [] };
  try {
    const entries = fs.readdirSync(templatesDir, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && (e.name.endsWith('.md') || e.name.endsWith('.mdx')))
      .map((e) => e.name);
    return { dir: 'templates', files };
  } catch {
    return { dir: null, files: [] };
  }
}

export function detectExistingContent(rootDir) {
  const existingLanes = {};
  walkLaneDirs(rootDir, rootDir, 0, existingLanes);
  return {
    existingLanes,
    customIntake: {
      ingestScript: detectIntakeScript(rootDir),
      intakePaths: detectIntakePaths(rootDir),
    },
    rootTemplates: detectRootTemplates(rootDir),
  };
}

// Convenience helper: pretty-print the detection result for init's
// "Skipped (deferred to existing project structure)" summary block.

export function formatDeferralSummary(detection) {
  const lines = [];
  for (const [lane, matches] of Object.entries(detection.existingLanes)) {
    const top = matches[0];
    const extra = matches.length > 1 ? ` (+${matches.length - 1} more)` : '';
    lines.push(`  • lane "${lane}": found existing ${top.path}/ (${top.markdownCount} md file${top.markdownCount === 1 ? '' : 's'})${extra}`);
  }
  if (detection.customIntake.ingestScript) {
    lines.push(`  • intake: custom script ./${detection.customIntake.ingestScript} detected`);
  }
  if (detection.customIntake.intakePaths.length) {
    lines.push(`  • intake: custom path${detection.customIntake.intakePaths.length === 1 ? '' : 's'} ${detection.customIntake.intakePaths.join(', ')} detected`);
  }
  if (detection.rootTemplates.dir && detection.rootTemplates.files.length) {
    lines.push(`  • templates: root ./${detection.rootTemplates.dir}/ has ${detection.rootTemplates.files.length} template file${detection.rootTemplates.files.length === 1 ? '' : 's'}`);
  }
  return lines.join('\n');
}

// Maps a lane key to the root-template file base name init would otherwise
// copy into docs/<lane>/templates/. Used so callers can ask "is the root
// templates/ already covering this lane?" without re-deriving the mapping.

export function rootTemplateCoversLane(detection, laneKey) {
  if (!detection.rootTemplates.dir) return false;
  const wanted = new Set([`${laneKey}.md`, `${laneKey.replace(/s$/, '')}.md`, `_template.md`, `template.md`]);
  return detection.rootTemplates.files.some((f) => wanted.has(f.toLowerCase()));
}

// Single decision function so both init entry points (init-unified.mjs and
// init-docs.mjs) skip the same lanes for the same reasons. force=true makes
// every decision a pass-through so power users can scaffold over an existing
// layout when they really want a parallel docs/ tree.

export function shouldScaffoldLane(laneKey, detection, { force = false } = {}) {
  if (force) return { skip: false };
  const matches = detection.existingLanes?.[laneKey];
  if (matches && matches.length > 0) {
    const top = matches[0];
    return {
      skip: true,
      reason: `existing ${top.path}/ has ${top.markdownCount} markdown file${top.markdownCount === 1 ? '' : 's'}`,
    };
  }
  return { skip: false };
}

export function shouldSkipProjectInbox(detection, { force = false } = {}) {
  if (force) return { skip: false };
  const { ingestScript, intakePaths } = detection.customIntake || {};
  if (ingestScript) {
    return { skip: true, reason: `custom intake script ./${ingestScript} detected` };
  }
  if (intakePaths && intakePaths.length > 0) {
    return { skip: true, reason: `custom intake path${intakePaths.length === 1 ? '' : 's'} ${intakePaths.join(', ')} detected` };
  }
  return { skip: false };
}
