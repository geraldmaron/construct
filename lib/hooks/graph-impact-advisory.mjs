#!/usr/bin/env node
/**
 * lib/hooks/graph-impact-advisory.mjs — PostToolUse hook: test-impact advisory on code edits.
 *
 * On Write|Edit under lib/, bin/, tests/, or src/, runs forward change-impact
 * over the dependency graph and surfaces affected tests on stderr. Non-blocking;
 * complements `construct impact` CLI and the doctor graph-staleness watcher.
 *
 * Also runs scoped incremental graph refresh (lib/graph/incremental.mjs)
 * and drains the relational outbox
 * when one exists — this hook is one of the
 * design's named applier-trigger surfaces (design doc §4: "the applier is
 * triggered by the existing surfaces — the graph-impact-advisory PostToolUse
 * hook, the doctor graph-staleness watcher, or an explicit construct graph
 * update — never a mandatory daemon"). Draining an empty outbox is a single
 * indexed SELECT, so this stays within budget on the common case; drain
 * failures are swallowed (advisory, not blocking) rather than surfaced here.
 *
 * @p95ms 50
 * @maxBlockingScope none (PostToolUse, non-blocking)
 *
 * @lifecycle PostToolUse
 * @matcher  Write|Edit|MultiEdit
 * @exits 0 = pass
 */

import { readFileSync } from 'node:fs';

import { computeImpact } from '../graph/impact.mjs';
import { checkGraphStaleness } from '../graph/staleness.mjs';
import { updateGraphForFiles } from '../graph/incremental.mjs';
import { packageRoot } from '../roots.mjs';

const CODE_RE = /^(lib|bin|src|tests)\/.*\.(?:m?js|jsx?|tsx?|cjs)$/;

let filePath = process.env.TOOL_INPUT_FILE_PATH;
let cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
if (!filePath) {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    filePath = input?.tool_input?.file_path || input?.tool_input?.path;
    if (input?.cwd) cwd = input.cwd;
  } catch { /* stdin optional */ }
}
if (!filePath) process.exit(0);

const rel = filePath.startsWith(cwd)
  ? filePath.slice(cwd.length).replace(/^\/+/, '')
  : filePath;

if (!CODE_RE.test(rel)) process.exit(0);

const stale = checkGraphStaleness(cwd);
if (stale.stale) {
  process.stderr.write(
    `[graph-impact] dependency graph stale (${stale.staleReason}). Run \`construct graph build\` before trusting impact output.\n`,
  );
}

const impact = computeImpact({ rootDir: cwd, changedFiles: [rel] });
if (!impact.graphPresent) {
  process.stderr.write('[graph-impact] no .construct/graph/ present — run `construct graph build` to enable test-impact advisories.\n');
  process.exit(0);
}

if (impact.affectedTests.length > 0) {
  const preview = impact.affectedTests.slice(0, 5).map((t) => t.replace(/^test:/, '')).join(', ');
  const more = impact.affectedTests.length > 5 ? ` (+${impact.affectedTests.length - 5} more)` : '';
  process.stderr.write(`[graph-impact] ${rel} may affect: ${preview}${more}\n`);
} else if (impact.coverageGaps.length > 0) {
  process.stderr.write(`[graph-impact] ${rel} has no capability edge in the dependency graph (coverage gap).\n`);
}

try {
  updateGraphForFiles(cwd, [rel], { rootDir: packageRoot, drain: true, origin: 'graph-impact-advisory' });
} catch { /* advisory incremental refresh; never blocks the hook */ }

process.exit(0);
