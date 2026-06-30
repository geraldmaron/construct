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

function commandExists(name) {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(checker, [name], { stdio: 'ignore' }).status === 0;
}

function extractPdfPages(pdfPath) {
  if (!commandExists('pdfinfo') || !commandExists('pdftotext')) return null;
  const info = spawnSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
  if (info.status !== 0) return null;
  const match = String(info.stdout || '').match(/^Pages:\s+(\d+)/m);
  const pages = Number(match?.[1] || 0);
  if (!pages) return null;
  const out = [];
  for (let page = 1; page <= pages; page += 1) {
    const result = spawnSync('pdftotext', ['-f', String(page), '-l', String(page), pdfPath, '-'], { encoding: 'utf8' });
    if (result.status !== 0) return null;
    out.push(String(result.stdout || '').replace(/\s+/g, ' ').trim());
  }
  return out;
}

function extractPdfText(pdfPath) {
  const pages = extractPdfPages(pdfPath);
  return pages ? pages.join(' ') : '';
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

test('published PDFs preserve ordered-list numbering and render figures', (t) => {
  const detection = detectPublishPipeline({ format: 'pdf', includeFigures: true, cwd: REPO, repoRoot: REPO });
  if (!detection.present) return;
  if (!commandExists('pdfinfo') || !commandExists('pdftotext')) {
    t.skip('pdfinfo/pdftotext not installed');
    return;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-polish-'));
  try {
    const input = path.join(dir, 'ordered-list.md');
    const out = path.join(dir, 'ordered-list.pdf');
    fs.writeFileSync(input, `---
title: Ordered list regression
artifactType: prd-platform
status: draft
owner: cx-product-manager
last_verified_at: 2026-06-28
---

# Ordered list regression

## Goals

1. **Enable enterprise SSO**: Allow organizations to configure one or more OIDC providers so users authenticate via their corporate IdP.
2. **Preserve local authorization**: Construct retains control over permissions, roles, and resource access; the IdP provides identity assertions only.
3. **Minimize migration friction**: Existing local accounts remain functional; users can link OIDC identities to existing accounts.
4. **Support compliance requirements**: Audit log captures IdP, subject, claims used, and authentication timestamp for compliance review.

## User flow

\`\`\`d2
direction: down

user: User navigates to Construct
session: Session valid?
granted: Access granted
login: Login page

user -> session
session -> granted: yes
session -> login: no
\`\`\`
`, 'utf8');

    const result = runPublish({
      inputPath: input,
      outputPath: out,
      strict: true,
      gate: false,
      artifactType: 'prd-platform',
      figures: true,
      cwd: dir,
      repoRoot: REPO,
    });
    assert.equal(result.ok, true, result.message);
    assert.ok(fs.existsSync(out));

    const extracted = extractPdfText(out);
    assert.match(extracted, /1\.\s+Enable enterprise SSO/i);
    assert.match(extracted, /2\.\s+Preserve local authorization/i);
    assert.match(extracted, /3\.\s+Minimize migration friction/i);
    assert.match(extracted, /4\.\s+Support compliance requirements/i);
    assert.doesNotMatch(extracted, /direction:\s+down/, 'diagram block should render as a figure, not remain literal source');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// K-1: --preview forces a render so the user can inspect output and see what was verified, even
// when the artifact's own gate level would not otherwise capture screenshots.

test('runPublish --preview captures render evidence and a validation report', (t) => {
  const detection = detectPublishPipeline({ format: 'pdf', includeFigures: true, cwd: REPO, repoRoot: REPO });
  if (!detection.present || !commandExists('pdftoppm')) {
    t.skip('pdf toolchain not installed');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-preview-'));
  try {
    const input = path.join(dir, 'note.md');
    const out = path.join(dir, 'note.pdf');
    fs.writeFileSync(input, '---\ntitle: Preview Note\n---\n\n## Summary\n\nA short note with an image-free body.\n');
    const result = runPublish({ inputPath: input, outputPath: out, format: 'pdf', gate: false, preview: true, cwd: dir, repoRoot: REPO });
    assert.equal(result.ok, true, result.message);
    const validation = result.ledger.validation;
    assert.ok(validation, 'expected a validation report');
    assert.ok(validation.render?.evidence, 'preview must capture render evidence');
    assert.ok(validation.render.result.images.length >= 1, 'preview must produce at least one screenshot');
    assert.ok(validation.a11y?.coverage, 'report states a11y coverage');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
