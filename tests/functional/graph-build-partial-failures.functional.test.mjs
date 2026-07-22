/**
 * tests/functional/graph-build-partial-failures.functional.test.mjs —
 * `construct graph build` surfaces swallowed seeder errors instead of
 * reporting unconditional success (construct-4uxq0.9.16).
 *
 * Before this fix: buildFromEmbed's validation errors and
 * buildFromRegistry's pack/specialists-org load failures were either
 * discarded by the caller (`runBuild` never read `.errors`) or had no return
 * field to surface at all (`buildFromRegistry` returned no `errors`/
 * `warnings`). `construct graph build` always printed `✓ graph built...` and
 * exited 0 regardless.
 *
 * Two fixtures exercise the two independent seeders:
 *   1. A project-tier embed manifest with `type: "embed"` but a missing
 *      required `embed` field, a case buildFromEmbed/loadEmbedCapabilities
 *      treats as a hard validation error landing in `errors`, forcing a
 *      non-zero exit / `ok: false`.
 *   2. A broken `pack.manifest.json` (invalid JSON) under the project pack
 *      tier — buildFromRegistry's embedBindings seeding step degrades rather
 *      than aborting (a broken pack should not blank the whole registry
 *      graph), landing its own diagnostic as a warning (exit stays 0 when it
 *      is the only issue), verified directly on buildFromRegistry's return
 *      value rather than only through the full CLI path, since
 *      loadEmbedCapabilities independently re-loads packs for specialist-id
 *      resolution and would also report the same broken pack as a hard
 *      error, masking whether buildFromRegistry's own warning plumbing works.
 *
 * runGraphCli is imported and called directly (not the spawned `bin/construct`
 * binary) because the CLI hardcodes `rootDir` to the real Construct install
 * (bin/construct's ROOT_DIR), with no flag to point it at a fixture root —
 * calling the same function `bin/construct graph build` dispatches to with a
 * fixture `rootDir` is the only way to exercise a deliberately broken rootDir
 * end to end while still running the real production code path
 * (lib/graph/cli.mjs's `runGraphCli` → `runBuild`), no mocks.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runGraphCli } from '../../lib/graph/cli.mjs';
import { buildFromRegistry } from '../../lib/graph/build-from-registry.mjs';
import { writeProjectEmbedManifest } from '../../lib/embed/capability-loader.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const dirs = [];
function freshDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const d of dirs) { try { rmTmpDir(d); } catch {} } });

// A fixture rootDir needs a copied registry/ catalog so
// lib/registry/loader.mjs's loadRegistry -> assembleRegistry call succeeds —
// a bare directory without registry catalogs is a pre-existing, unrelated
// crash surface, not something this bead's fix touches.

function makeFixtureRoot(prefix) {
  const root = freshDir(prefix);
  // Construct 2.0 assemble requires a real registry catalog under rootDir.
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  fs.cpSync(path.join(repoRoot, 'registry'), path.join(root, 'registry'), { recursive: true });
  return root;
}

function captureOutput(fn) {
  const out = [];
  const err = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk) => { out.push(chunk); return true; };
  process.stderr.write = (chunk) => { err.push(chunk); return true; };
  try {
    return { result: fn(), stdout: out.join(''), stderr: err.join('') };
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
}

function withHomeOverride(root, fn) {
  const prior = process.env.CONSTRUCT_HOME_OVERRIDE;
  process.env.CONSTRUCT_HOME_OVERRIDE = root;
  try {
    return fn();
  } finally {
    if (prior === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
    else process.env.CONSTRUCT_HOME_OVERRIDE = prior;
  }
}

test('a malformed embed manifest surfaces as a build error, not silent success', () => {
  const root = makeFixtureRoot('cx-graph-embed-err-root-');
  const project = freshDir('cx-graph-embed-err-proj-');

  writeProjectEmbedManifest('broken-preset', {
    id: 'broken-preset',
    type: 'embed',
    version: '1.0.0',
    defaultApprovalMode: 'proposal-only',
    embed: {
      specialist: 'cx-operations',
      providerBindings: ['github'],
      framework: 'cx-ops-triage',
      outputContract: 'proposal.v1',
      proposalAuthority: 'propose-only',
      // runtime intentionally omitted — a required embed field.
    },
  }, root);

  const jsonRun = withHomeOverride(root, () => captureOutput(
    () => runGraphCli(['build', '--json'], { rootDir: root, projectDir: project }),
  ));
  assert.equal(jsonRun.result, 1, 'a hard embed validation error must exit non-zero');
  const parsed = JSON.parse(jsonRun.stdout);
  assert.equal(parsed.ok, false, '--json ok must be false when a hard error is present');
  assert.ok(
    parsed.errors.some((e) => /missing required field/.test(e)),
    `expected hard validation errors in ${JSON.stringify(parsed.errors)}`,
  );

  const humanRun = withHomeOverride(root, () => captureOutput(
    () => runGraphCli(['build'], { rootDir: root, projectDir: project }),
  ));
  assert.equal(humanRun.result, 1);
  assert.match(humanRun.stdout, /✓ graph built:/, 'the graph still builds — degradation, not abort');
  assert.match(humanRun.stdout, /⚠ \d+ seeder error\(s\) — see details above/);
  assert.match(humanRun.stderr, /missing required field/);
});

test('a broken pack manifest is captured in buildFromRegistry\'s warnings field instead of being discarded', () => {
  const root = makeFixtureRoot('cx-graph-pack-warn-root-');

  const packDir = path.join(root, '.construct', 'packs', 'broken-pack');
  fs.mkdirSync(packDir, { recursive: true });
  fs.writeFileSync(path.join(packDir, 'pack.manifest.json'), '{ not valid json');

  const result = withHomeOverride(root, () => buildFromRegistry({ rootDir: root }));
  assert.ok(Array.isArray(result.errors), 'buildFromRegistry return shape carries an errors field');
  assert.ok(Array.isArray(result.warnings), 'buildFromRegistry return shape carries a warnings field');
  assert.ok(
    result.warnings.some((w) => w.includes('pack.manifest.json') && w.includes('failed to parse JSON')),
    `expected the broken pack's parse failure in ${JSON.stringify(result.warnings)}`,
  );
});

test('construct graph build surfaces a broken pack instead of reporting unconditional success', () => {
  const root = makeFixtureRoot('cx-graph-pack-cli-root-');
  const project = freshDir('cx-graph-pack-cli-proj-');

  const packDir = path.join(root, '.construct', 'packs', 'broken-pack');
  fs.mkdirSync(packDir, { recursive: true });
  fs.writeFileSync(path.join(packDir, 'pack.manifest.json'), '{ not valid json');

  const jsonRun = withHomeOverride(root, () => captureOutput(
    () => runGraphCli(['build', '--json'], { rootDir: root, projectDir: project }),
  ));
  const parsed = JSON.parse(jsonRun.stdout);
  const allDiagnostics = [...parsed.errors, ...parsed.warnings];
  assert.ok(
    allDiagnostics.some((d) => d.includes('pack.manifest.json') && d.includes('failed to parse JSON')),
    `expected the broken pack surfaced somewhere in errors/warnings: ${JSON.stringify(allDiagnostics)}`,
  );
  // Pack load failures degrade (warning) rather than failing the whole registry
  // graph — exit 0 / ok true is correct when the only issue is a broken pack.
  assert.equal(jsonRun.result, 0);
  assert.equal(parsed.ok, true);
  assert.ok(parsed.warnings.length > 0, 'success must still carry the pack diagnostic');
});