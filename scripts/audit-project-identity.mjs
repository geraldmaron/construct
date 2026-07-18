#!/usr/bin/env node
/**
 * scripts/audit-project-identity.mjs — ADR-0092 reconciliation audit.
 *
 * Read-only report on project-identity state, run before any manual cleanup
 * of `~/.construct/projects/<key>/` directories left by a non-canonical
 * derivation (disposition-matrix.md D6, ADR-0092's Consequences §5). Never
 * deletes or merges anything — it only names what a human should review.
 *
 * Checks:
 *   1. The canonical key (`deriveProjectKey`) for the given project root, and
 *      whether its state directory already exists.
 *   2. The `homedir()`-fallback bucket a project with no `.construct/context.md`
 *      marker, no enclosing git repo, and no `CX_DATA_DIR` override still
 *      resolves to (ADR-0092's "second, independent divergence trigger") —
 *      flagged, never merged automatically, since it may mix state from
 *      multiple unrelated local-only projects and cannot be safely
 *      disaggregated by inspection alone.
 *
 * Usage: node scripts/audit-project-identity.mjs [projectRoot]
 */

import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

import { deriveProjectKey } from '../lib/state-root.mjs';
import { homeDir } from '../lib/paths.mjs';

function projectsRoot() {
  return path.join(homeDir(), '.construct', 'projects');
}

function describeBucket(label, key) {
  const dir = path.join(projectsRoot(), key);
  const exists = fs.existsSync(dir);
  let sizeNote = 'absent';
  if (exists) {
    try {
      const entries = fs.readdirSync(dir);
      sizeNote = entries.length ? `present (${entries.length} entries: ${entries.join(', ')})` : 'present (empty)';
    } catch {
      sizeNote = 'present (unreadable)';
    }
  }
  return { label, key, dir, exists, sizeNote };
}

export function auditProjectIdentity(projectRoot = process.cwd()) {
  const canonicalKey = deriveProjectKey(projectRoot);
  const homedirKey = deriveProjectKey(homedir());

  const findings = [
    describeBucket('canonical (this project)', canonicalKey),
    describeBucket('homedir()-fallback bucket', homedirKey),
  ];

  const flagged = findings
    .filter((f) => f.exists && f.key === homedirKey)
    .map((f) => `${f.dir} — ${f.sizeNote}: may mix state from multiple unrelated local-only projects that hit the pre-ADR-0092 homedir() fallback (no .construct/context.md, no git remote nearby, no CX_DATA_DIR override). Review manually; do not merge or delete automatically (ADR-0092, Consequences §5).`);

  return { projectRoot, canonicalKey, homedirKey, findings, flagged };
}

function main() {
  const projectRoot = process.argv[2] || process.cwd();
  const report = auditProjectIdentity(projectRoot);
  process.stdout.write(`Project root: ${report.projectRoot}\n`);
  process.stdout.write(`Canonical key (deriveProjectKey): ${report.canonicalKey}\n\n`);
  for (const f of report.findings) {
    process.stdout.write(`[${f.label}] ${f.dir}\n  ${f.sizeNote}\n`);
  }
  if (report.flagged.length) {
    process.stdout.write('\nFlagged for manual review:\n');
    for (const line of report.flagged) process.stdout.write(`  - ${line}\n`);
  } else {
    process.stdout.write('\nNo stray homedir()-fallback bucket found.\n');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
