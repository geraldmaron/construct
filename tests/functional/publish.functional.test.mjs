/**
 * publish.functional.test.mjs — `construct publish` and `construct tools detect`.
 *
 * @capability publish.distribution
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

import { detectPublishPipeline } from '../../lib/publish-tooling.mjs';
import { runPublish, formatGateFailureMessage } from '../../lib/publish.mjs';
import { validateArtifactRelease } from '../../lib/artifact-release-gate.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const BIN = path.join(REPO, 'bin', 'construct');
const STUB = path.join(REPO, 'tests', 'fixtures', 'publish', 'agentic-platforms-stub.md');
const GOLDEN = path.join(REPO, 'tests', 'fixtures', 'publish', 'golden-prd-platform.md');

function run(args, cwd, env = {}) {
  return spawnSync(BIN, args, {
    cwd,
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...process.env,
      CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
      BOOTSTRAP_CHECKED: '1',
      CONSTRUCT_DISABLE_AUTO_CLEANUP: '1',
      ...env,
    },
  });
}

test('detectPublishPipeline returns structured missing list', () => {
  const detection = detectPublishPipeline({
    format: 'pdf',
    includeFigures: true,
    includeTerminalDemo: true,
    cwd: REPO,
    repoRoot: REPO,
    env: { ...process.env, PATH: '/usr/bin:/bin' },
  });
  assert.equal(detection.ok, true);
  assert.equal(typeof detection.present, 'boolean');
  assert.ok(Array.isArray(detection.missing));
});

test('construct tools detect exits 0 or 2 with JSON', () => {
  const result = run(['tools', 'detect', '--json'], REPO);
  assert.ok([0, 2].includes(result.status), `unexpected exit ${result.status}`);
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.steps);
});

test('construct publish --source-only on brief writes without strict failure', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-'));
  try {
    const brief = path.join(dir, 'brief.md');
    fs.writeFileSync(brief, `---
publish:
  demo: quickstart
---

# Test brief

\`\`\`d2
a -> b
\`\`\`
`, 'utf8');

    const result = runPublish({
      inputPath: brief,
      format: 'pdf',
      demos: ['quickstart'],
      strict: false,
      sourceOnly: true,
      gate: false,
      cwd: dir,
      repoRoot: REPO,
    });
    assert.equal(result.ok, true);
    assert.ok(result.ledger?.demos?.length >= 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runPublish --strict fails when tooling missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-strict-'));
  try {
    const brief = path.join(dir, 'brief.md');
    fs.writeFileSync(brief, '# Brief\n', 'utf8');
    const result = runPublish({
      inputPath: brief,
      strict: true,
      figures: true,
      gate: false,
      cwd: dir,
      repoRoot: REPO,
      env: { PATH: '/usr/bin:/bin' },
    });
    assert.equal(result.ok, false);
    assert.ok(result.missing?.length >= 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('golden prd-platform fixture passes release gate', () => {
  const gate = validateArtifactRelease({
    filePath: GOLDEN,
    type: 'prd-platform',
    cwd: REPO,
    rootDir: REPO,
  });
  assert.equal(gate.ok, true, gate.errors.join('; '));
});

test('runPublish blocks agentic-platforms stub at release gate', () => {
  const result = runPublish({
    inputPath: STUB,
    strict: true,
    gate: true,
    artifactType: 'prd-platform',
    cwd: REPO,
    repoRoot: REPO,
    env: { PATH: process.env.PATH },
  });
  assert.equal(result.ok, false);
  assert.equal(result.gateBlocked, true);
  assert.match(result.message, /Publish blocked/);
  assert.match(result.message, /Remediation/);
});

test('formatGateFailureMessage includes validate and workflow hints', () => {
  const gate = validateArtifactRelease({ filePath: STUB, type: 'prd-platform', cwd: REPO, rootDir: REPO });
  const msg = formatGateFailureMessage(gate, { inputPath: STUB, cwd: REPO });
  assert.match(msg, /artifact validate/);
  assert.match(msg, /workflow invoke/);
  assert.match(msg, /prd-workflow/);
});

test('construct publish CLI blocks stub with exit 2', () => {
  const result = run(['publish', STUB, '--type=prd-platform', '--figures'], REPO);
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /Publish blocked/);
});

test('runPublish --no-gate skips gate on stub', () => {
  const result = runPublish({
    inputPath: STUB,
    strict: false,
    gate: false,
    artifactType: 'prd-platform',
    cwd: REPO,
    repoRoot: REPO,
    env: { PATH: '/usr/bin:/bin' },
  });
  assert.notEqual(result.gateBlocked, true);
});

test('runPublish exports golden fixture when toolchain present', () => {
  const detection = detectPublishPipeline({ format: 'pdf', includeFigures: true, cwd: REPO, repoRoot: REPO });
  if (!detection.present) {
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-golden-'));
  try {
    const out = path.join(dir, 'golden.pdf');
    const result = runPublish({
      inputPath: GOLDEN,
      outputPath: out,
      strict: true,
      gate: true,
      artifactType: 'prd-platform',
      figures: true,
      cwd: REPO,
      repoRoot: REPO,
    });
    assert.equal(result.ok, true, result.message);
    assert.ok(fs.existsSync(out));
    assert.ok(fs.statSync(out).size > 1000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
