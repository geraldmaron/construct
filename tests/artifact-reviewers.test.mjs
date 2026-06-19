/**
 * tests/artifact-reviewers.test.mjs — manifest reviewer resolution and bypass markers.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  missingRequiredReviewers,
  parseReleaseGateFrontmatter,
  readAgentLogReviewers,
} from '../lib/artifact-reviewers.mjs';
import { validateArtifactRelease } from '../lib/artifact-release-gate.mjs';
import { validateArtifactPostconditions } from '../lib/contracts/validate.mjs';

test('readAgentLogReviewers collects specialist ids', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rev-log-'));
  try {
    mkdirSync(join(dir, '.cx'), { recursive: true });
    writeFileSync(
      join(dir, '.cx', 'agent-log.jsonl'),
      '{"agent":"cx-devil-advocate"}\n{"specialist":"cx-reviewer"}\n',
    );
    const seen = readAgentLogReviewers(dir);
    assert.ok(seen.has('cx-devil-advocate'));
    assert.ok(seen.has('cx-reviewer'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missingRequiredReviewers uses manifest for prd type', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rev-prd-'));
  try {
    mkdirSync(join(dir, 'docs', 'prd'), { recursive: true });
    const file = join(dir, 'docs', 'prd', '001.md');
    writeFileSync(file, '# PRD\n');
    const missing = missingRequiredReviewers({ filePath: file, cwd: dir });
    assert.ok(missing.includes('cx-devil-advocate'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('release gate bypass requires reason in frontmatter', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rev-bypass-'));
  try {
    mkdirSync(join(dir, 'docs', 'prd'), { recursive: true });
    const file = join(dir, 'docs', 'prd', '001.md');
    writeFileSync(file, '---\ncx_release_gate: bypass\n---\n\n# PRD\n');
    const bad = validateArtifactRelease({ filePath: file, type: 'prd', cwd: dir });
    assert.equal(bad.ok, false);
    assert.match(bad.errors.join(' '), /cx_release_gate_reason/);

    writeFileSync(file, '---\ncx_release_gate: bypass\ncx_release_gate_reason: executive waiver for draft review\n---\n\n# PRD\n');
    const ok = validateArtifactRelease({ filePath: file, type: 'prd', cwd: dir });
    assert.equal(ok.ok, true);
    assert.ok(ok.bypassed);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('artifact-reviewers-seen postcondition blocks missing reviewers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rev-pc-'));
  try {
    mkdirSync(join(dir, 'docs', 'prd'), { recursive: true });
    const file = join(dir, 'docs', 'prd', '001.md');
    writeFileSync(file, readFileSync(join(process.cwd(), 'templates/docs/prd.md'), 'utf8'));
    const errors = validateArtifactPostconditions({
      contract: {
        postconditions: [{
          id: 'manifest-reviewers',
          check: 'artifact-reviewers-seen',
          fromManifest: true,
        }],
      },
      artifactPath: file,
      cwd: dir,
    });
    assert.ok(errors.some((e) => /cx-devil-advocate/.test(e)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseReleaseGateFrontmatter reads bypass fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rev-fm-'));
  try {
    const file = join(dir, 'x.md');
    writeFileSync(file, '---\ncx_release_gate: bypass\ncx_release_gate_reason: hotfix\n---\n');
    const parsed = parseReleaseGateFrontmatter(file);
    assert.equal(parsed.bypass, true);
    assert.equal(parsed.reason, 'hotfix');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
