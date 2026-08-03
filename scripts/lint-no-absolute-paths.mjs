#!/usr/bin/env node
/**
 * lint-no-absolute-paths.mjs — v2 shipped machine-specific absolute paths
 * baked into committed .mcp.json / settings.json (open bug construct-eda8s
 * in the predecessor). This lint fails CI if any tracked, non-generated file
 * contains a path rooted at a real user's home directory or /Users//home.
 * Host configs must be generated per-machine by sync, never committed.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ABSOLUTE_HOME = /\/(Users|home)\/[a-zA-Z0-9._-]+/;
const EXEMPT = [
  /^tests\//,
  /^dist\//,
  /^node_modules\//,
  /\.md$/,
  // .beads/issues.jsonl carries a tracker-stamped `source_repo_path` field —
  // third-party provenance metadata, not a path Construct's own code writes
  // or depends on at runtime. Different category from the bug this lint
  // targets (a host config file whose functional path breaks on another
  // machine); it's informational and safe to vary per clone.
  /^\.beads\//,
];

function trackedFiles() {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

let violations = 0;
for (const file of trackedFiles()) {
  if (EXEMPT.some((re) => re.test(file))) continue;
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue; // binary or unreadable — not our concern
  }
  const match = content.match(ABSOLUTE_HOME);
  if (match) {
    violations += 1;
    process.stderr.write(`absolute-path violation: ${file} contains "${match[0]}"\n`);
  }
}

if (violations > 0) {
  process.stderr.write(`\n${violations} file(s) contain machine-specific absolute paths.\n`);
  process.exit(1);
}
process.stdout.write('lint-no-absolute-paths: clean\n');
