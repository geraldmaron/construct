/**
 * tests/functional/templates-register-adhoc.functional.test.mjs
 *
 * Template-optional generation (bead construct-760c.5). Two ways to author a
 * document class the builtin manifest never registered, with the builtin
 * (specialists/artifact-manifest.json) held byte-identical throughout:
 *
 *   1. `construct templates register <type>` (real spawned binary) writes a
 *      project template under .construct/templates/docs/<type>.md and a project-tier
 *      artifact-manifest overlay entry; the registered class then resolves and
 *      author_artifact (dry-run scaffold, no live model) drafts from the user's
 *      template and runs the release gate.
 *   2. The sanctioned `adhoc` type authors a one-off from instructions with
 *      zero prior registration and still clears the gate; missing instructions
 *      are rejected, and naming a registered class through adhoc is redirected.
 *
 * An unregistered non-adhoc class keeps today's classification/registration
 * response (the gate stays intact). No live LLM: the artifact loop invokes the
 * embedded workflow in proposal-only mode, which performs no network I/O.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'construct');
const BUILTIN_MANIFEST = path.join(REPO_ROOT, 'specialists', 'artifact-manifest.json');

const dirs = [];
function freshProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-templates-register-'));
  dirs.push(dir);
  return dir;
}

// In-process artifact-loop calls reach the machine-scoped state root through
// the real HOME (observation-store vectorClientFor), so the whole process gets
// a redirected CONSTRUCT_HOME_OVERRIDE or every fixture registers a real
// ~/.construct/projects key (construct-9y93c).

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-templates-register-home-'));
const originalHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;

test.after(() => {
  if (originalHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = originalHomeOverride;
  try { rmTmpDir(homeOverride); } catch { /* tmpdir teardown is best-effort */ }
  for (const d of dirs) { try { rmTmpDir(d); } catch { /* tmpdir teardown is best-effort */ } }
});

function builtinBytes() {
  return fs.readFileSync(BUILTIN_MANIFEST);
}

test('construct templates register writes a project template + overlay, leaving the builtin manifest untouched (AC1, AC4)', () => {
  const before = builtinBytes();
  const cwd = freshProject();
  const res = spawnSync(process.execPath, [BIN, 'templates', 'register', 'convergence-brief', '--description', 'Cross-project convergence brief'], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, HOME: cwd, USERPROFILE: cwd },
  });
  assert.equal(res.status, 0, res.stderr || res.stdout);

  const templatePath = path.join(cwd, '.construct', 'templates', 'docs', 'convergence-brief.md');
  const overlayPath = path.join(cwd, '.construct', 'artifact-manifest.overlay.json');
  assert.ok(fs.existsSync(templatePath), 'project template written');
  assert.ok(fs.existsSync(overlayPath), 'project overlay written');

  const overlay = JSON.parse(fs.readFileSync(overlayPath, 'utf8'));
  assert.ok(overlay.artifacts['convergence-brief'], 'overlay carries the registered type');
  assert.equal(overlay.artifacts['convergence-brief'].description, 'Cross-project convergence brief');

  assert.deepEqual(builtinBytes(), before, 'builtin artifact-manifest.json is byte-identical after register');
});

test('a registered custom type drafts from the user template and runs the gate; unknown types stay gated (AC1, AC3)', async () => {
  const before = builtinBytes();
  const cwd = freshProject();
  const prevCwd = process.cwd();
  const { authorArtifact } = await import('../../lib/mcp/tools/artifact-author.mjs');
  const { registerArtifactType } = await import('../../lib/artifact-manifest-overlay.mjs');
  const { getTemplate } = await import('../../lib/mcp/tools/skills.mjs');

  try {
    process.chdir(cwd);
    registerArtifactType({ type: 'convergence-brief', description: 'Cross-project convergence brief', cwd });

    // get_template resolves the project override for the registered class.
    const tmpl = getTemplate({ name: 'convergence-brief' }, { ROOT_DIR: REPO_ROOT });
    assert.equal(tmpl.source, 'project-override');
    assert.match(tmpl.content, /registered via/);

    const custom = await authorArtifact(
      { artifact_type: 'convergence-brief', subject: 'Q3 convergence', dry_run: true, cwd },
      { ROOT_DIR: REPO_ROOT },
    );
    assert.equal(custom.artifact_type, 'convergence-brief');
    assert.equal(custom.gate, 'PASS', JSON.stringify(custom.errors));
    const draft = fs.readFileSync(path.join(cwd, custom.path), 'utf8');
    assert.match(draft, /registered via/, 'draft used the registered template skeleton');

    // AC3: an unregistered non-adhoc class returns the classification result, not a PRD.
    const unknown = await authorArtifact(
      { artifact_type: 'never-registered-thing', subject: 'x', cwd },
      { ROOT_DIR: REPO_ROOT },
    );
    assert.equal(unknown.ok, false);
    assert.equal(unknown.status, 'unrecognized');
    assert.equal(unknown.classification_required, true);
  } finally {
    process.chdir(prevCwd);
  }

  assert.deepEqual(builtinBytes(), before, 'builtin manifest unchanged across custom-type authoring');
});

test('adhoc authors from instructions with zero registration and passes the gate; guards hold (AC2, AC4, R3)', async () => {
  const before = builtinBytes();
  const cwd = freshProject();
  const prevCwd = process.cwd();
  const { authorArtifact } = await import('../../lib/mcp/tools/artifact-author.mjs');

  try {
    process.chdir(cwd);

    const adhoc = await authorArtifact({
      artifact_type: 'adhoc',
      title: 'Q3 strategy convergence',
      instructions: 'Summarize how the app and sdk strategies converge. Identify two shared bets and one divergence, then recommend a sequencing. Keep it to a page.',
      cwd,
    }, { ROOT_DIR: REPO_ROOT });
    assert.equal(adhoc.artifact_type, 'adhoc');
    assert.equal(adhoc.gate, 'PASS', JSON.stringify(adhoc.errors));
    assert.ok(adhoc.path.startsWith('docs/adhoc/'), `adhoc lands in its own lane: ${adhoc.path}`);
    assert.ok(fs.existsSync(path.join(cwd, adhoc.path)), 'adhoc artifact materialized');

    // R3: adhoc requires explicit title + instructions.
    const missing = await authorArtifact({ artifact_type: 'adhoc', title: 'X', cwd }, { ROOT_DIR: REPO_ROOT });
    assert.equal(missing.ok, false);
    assert.equal(missing.status, 'invalid-request');

    // R3: naming a registered class through adhoc is redirected, not a bypass.
    const redirect = await authorArtifact({
      artifact_type: 'adhoc',
      title: 'memo',
      instructions: 'Draft a memo about the migration plan with enough detail to clear the prose floor.',
      cwd,
    }, { ROOT_DIR: REPO_ROOT });
    assert.equal(redirect.ok, false);
    assert.equal(redirect.status, 'redirect');
    assert.equal(redirect.redirect_to, 'memo');
  } finally {
    process.chdir(prevCwd);
  }

  assert.deepEqual(builtinBytes(), before, 'builtin manifest unchanged across adhoc authoring');
});
