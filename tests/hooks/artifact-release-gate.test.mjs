/**
 * tests/hooks/artifact-release-gate.test.mjs — PostToolUse artifact gate hook.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkArtifactGateNotice } from '../../lib/artifact-gate-notice.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOK = join(REPO_ROOT, 'lib', 'hooks', 'artifact-release-gate.mjs');

function runHook(filePath, cwd = REPO_ROOT) {
  return spawnSync(process.execPath, [HOOK], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TOOL_INPUT_FILE_PATH: filePath,
      CLAUDE_PROJECT_DIR: cwd,
      CI: 'false',
      NODE_ENV: 'development',
    },
  });
}

test('passes when typed artifact satisfies manifest structure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'art-gate-ok-'));
  try {
    mkdirSync(join(dir, 'docs', 'adr'), { recursive: true });
    const draft = join(dir, 'docs', 'adr', '0001-ok.md');
    writeFileSync(draft, readFileSync(join(REPO_ROOT, 'templates/docs/adr.md'), 'utf8'));
    assert.equal(checkArtifactGateNotice(draft, { cwd: dir }), null);
    const r = runHook(draft, dir);
    assert.equal(r.status, 0);
  } finally {
    rmTmpDir(dir);
  }
});

test('advises when a docs/adr draft is missing required sections', () => {
  const dir = mkdtempSync(join(tmpdir(), 'art-gate-'));
  try {
    mkdirSync(join(dir, 'docs', 'adr'), { recursive: true });
    const draft = join(dir, 'docs', 'adr', '0001-draft.md');
    writeFileSync(draft, '# ADR\n\n## Problem\n\nx\n');
    const notice = checkArtifactGateNotice(draft, { cwd: dir });
    assert.ok(notice);
    assert.equal(notice.type, 'adr');
    assert.ok(notice.errors.some((e) => /Decision/.test(e)));
    const r = runHook(draft, dir);
    assert.equal(r.status, 0, 'advisory hook must not block');
  } finally {
    rmTmpDir(dir);
  }
});

test('ignores non-artifact markdown paths', () => {
  const r = runHook(join(REPO_ROOT, 'README.md'));
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
});
