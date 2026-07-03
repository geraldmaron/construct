/**
 * tests/workflows/workflow-defs-drift.test.mjs — regression guard for LMCP-D2.
 *
 * lib/embedded-contract/workflow-defs.mjs must stay a thin shim over
 * lib/workflows/loader.mjs (LMCP-D1) so hand-editing the workflow catalog is
 * impossible. These tests pin that invariant against the committed file and
 * exercise scripts/check-workflow-defs-drift.mjs's pure check functions
 * against throwaway source strings/objects — never by editing the real
 * workflow-defs.mjs in place, since node --test runs files concurrently and
 * other suites import that module mid-run.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { loadAllWorkflows } from '../../lib/workflows/loader.mjs';
import { listWorkflowDefs } from '../../lib/embedded-contract/workflow-defs.mjs';
import { checkSource, checkAgainstManifests } from '../../scripts/check-workflow-defs-drift.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SHIM_PATH = join(ROOT, 'lib', 'embedded-contract', 'workflow-defs.mjs');
const CHECK_SCRIPT = join(ROOT, 'scripts', 'check-workflow-defs-drift.mjs');

test('workflow-defs.mjs imports loadAllWorkflows and holds no static catalog entries', () => {
  const source = readFileSync(SHIM_PATH, 'utf8');
  assert.deepEqual(checkSource(source), []);
});

test('checkSource flags a hand-authored object-literal catalog entry', () => {
  const hacked = "import { loadAllWorkflows } from '../workflows/loader.mjs';\n\nconst DEFS = {\n  'evidence-ingest': {\n    tier: 'fast',\n  },\n};\n";
  const diffs = checkSource(hacked);
  assert.ok(diffs.length > 0);
  assert.match(diffs[0], /hand-authored object-literal entry/);
});

test('checkSource flags a missing loader import', () => {
  const hacked = "const DEFS = {};\nexport const WORKFLOW_TYPES = [];\n";
  const diffs = checkSource(hacked);
  assert.ok(diffs.some((d) => d.includes('no longer imports loadAllWorkflows')));
});

test('checkSource passes clean re-export style source', () => {
  const clean = "import { loadAllWorkflows } from '../workflows/loader.mjs';\n\nconst { workflows } = loadAllWorkflows();\nconst DEFS = {};\nfor (const wf of workflows) {\n  DEFS[wf.id] = { tier: wf.tier };\n}\n";
  assert.deepEqual(checkSource(clean), []);
});

test('every exported workflow def traces to a real manifest id', () => {
  const { workflows } = loadAllWorkflows();
  const defs = listWorkflowDefs();
  assert.ok(defs.length > 0);
  assert.deepEqual(checkAgainstManifests(workflows, defs), []);
});

test('checkAgainstManifests flags a shim entry with no backing manifest', () => {
  const workflows = [{ id: 'prd-draft' }];
  const shimDefs = [{ type: 'prd-draft' }, { type: 'invented-workflow' }];
  const diffs = checkAgainstManifests(workflows, shimDefs);
  assert.ok(diffs.some((d) => d.includes('"invented-workflow"') && d.includes('no manifest declares')));
});

test('checkAgainstManifests flags a manifest missing from the shim', () => {
  const workflows = [{ id: 'prd-draft' }, { id: 'orphaned-manifest' }];
  const shimDefs = [{ type: 'prd-draft' }];
  const diffs = checkAgainstManifests(workflows, shimDefs);
  assert.ok(diffs.some((d) => d.includes('"orphaned-manifest"') && d.includes('does not export it')));
});

test('drift check CLI passes against the committed shim', () => {
  const out = execFileSync('node', [CHECK_SCRIPT, '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /in sync with manifests/);
});
