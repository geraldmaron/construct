#!/usr/bin/env node
/**
 * scripts/check-workflow-defs-drift.mjs — guard against workflow-defs.mjs
 * reverting to a hand-maintained catalog.
 *
 * lib/embedded-contract/workflow-defs.mjs (LMCP-D2) computes its workflow
 * catalog exclusively from lib/workflows/loader.mjs (LMCP-D1), which reads
 * builtin/pack/project *.manifest.json files at import time. Because the
 * catalog is derived live, there is nothing to "regenerate" — the drift this
 * guards against is a source-level regression: a hand-edit that reintroduces
 * a static, hardcoded workflow catalog (a literal object keyed by workflow
 * id) instead of deriving DEFS from loadAllWorkflows(). Two checks:
 *
 *   1. Static (checkSource) — the source text must import loadAllWorkflows
 *      from ../workflows/loader.mjs and must not contain a hand-authored
 *      object literal shaped like the old static DEFS catalog. Exported as a
 *      pure function of source text so tests can exercise it against a
 *      throwaway string instead of mutating the real file on disk (this
 *      module is imported by other test files that run concurrently under
 *      `node --test`, so editing the real file in place would race them).
 *   2. Behavioral (checkAgainstManifests) — every id the shim exports must be
 *      traceable to a real manifest id and vice versa, so a hand-added extra
 *      entry cannot silently coexist with the manifest-derived ones.
 *
 * Usage:
 *   node scripts/check-workflow-defs-drift.mjs           — print result
 *   node scripts/check-workflow-defs-drift.mjs --check    — exit non-zero on drift
 *
 * Exit code 0 = no drift. Non-zero (with --check) = drift detected.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHIM_PATH = join(__dirname, '..', 'lib', 'embedded-contract', 'workflow-defs.mjs');

const STATIC_ENTRY_PATTERN = /^\s*['"][a-z][a-z0-9-]*['"]\s*:\s*\{/m;

/**
 * checkSource(source)
 *
 * Pure check against source text: no loader import, or a hand-authored
 * object-literal entry, is drift. Returns an array of diff messages (empty
 * when clean).
 *
 * @param {string} source
 * @returns {string[]}
 */
export function checkSource(source) {
  const diffs = [];
  if (!/from\s+['"]\.\.\/workflows\/loader\.mjs['"]/.test(source)) {
    diffs.push('source no longer imports loadAllWorkflows from ../workflows/loader.mjs — catalog may be hand-maintained again');
  }
  if (STATIC_ENTRY_PATTERN.test(source)) {
    diffs.push(`source contains a hand-authored object-literal entry (matches /${STATIC_ENTRY_PATTERN.source}/) — workflow catalog entries must come from manifests, not source`);
  }
  return diffs;
}

/**
 * checkAgainstManifests(workflows, shimDefs)
 *
 * Pure check that the shim's exported catalog and the manifest-derived
 * catalog name exactly the same set of workflow ids.
 *
 * @param {Array<{id: string, type?: string}>} workflows
 * @param {Array<{type: string}>} shimDefs
 * @returns {string[]}
 */
export function checkAgainstManifests(workflows, shimDefs) {
  const diffs = [];
  // Embed manifests are a workflow-manifest specialization the executable
  // catalog deliberately excludes (they carry an embed block, no role chain),
  // so an embed manifest is not expected to have a shim export.
  const manifestIds = new Set(workflows.filter((w) => w.type !== 'embed').map((w) => w.id));
  for (const def of shimDefs) {
    if (!manifestIds.has(def.type)) {
      diffs.push(`workflow-defs.mjs exports "${def.type}" but no manifest declares that id`);
    }
  }
  for (const id of manifestIds) {
    if (!shimDefs.some((d) => d.type === id)) {
      diffs.push(`manifest declares "${id}" but workflow-defs.mjs does not export it`);
    }
  }
  return diffs;
}

async function main() {
  const check = process.argv.slice(2).includes('--check');
  const diffs = [];

  diffs.push(...checkSource(readFileSync(SHIM_PATH, 'utf8')));

  const { loadAllWorkflows } = await import('../lib/workflows/loader.mjs');
  const { listWorkflowDefs } = await import('../lib/embedded-contract/workflow-defs.mjs');

  const { workflows, errors } = loadAllWorkflows();
  if (errors.length > 0) {
    diffs.push(...errors.map((e) => `manifest load error: ${e}`));
  }
  diffs.push(...checkAgainstManifests(workflows, listWorkflowDefs()));

  if (diffs.length > 0) {
    console.error('workflow-defs.mjs drift detected:');
    for (const d of diffs) console.error(`  ${d}`);
    console.error('lib/embedded-contract/workflow-defs.mjs must derive its catalog exclusively from lib/workflows/loader.mjs.');
    process.exit(1);
  }

  if (check) {
    console.log(`workflow-defs.mjs in sync with manifests (${workflows.length} workflow types, no hand-authored entries detected)`);
  }
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
