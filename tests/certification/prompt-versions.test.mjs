/**
 * tests/certification/prompt-versions.test.mjs — certified prompt-version hash and gate logic.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computePromptVersionPair,
  evaluatePromptVersionGate,
  hashCertifiedFragmentSet,
  promptVersionPairKey,
} from '../../lib/certification/prompt-versions.mjs';
import { readCertifiedPromptVersions } from '../../lib/certification/store.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('hashCertifiedFragmentSet is stable for the same fragment content', () => {
  const fragments = [
    { type: 'core', label: 'engineer', content: 'alpha' },
    { type: 'model-profile', label: 'model-profile.balanced', content: 'beta' },
  ];
  const first = hashCertifiedFragmentSet(fragments);
  const second = hashCertifiedFragmentSet(fragments);
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test('computePromptVersionPair changes when core prompt content changes', () => {
  const before = computePromptVersionPair('engineer', 'balanced', { rootDir: REPO });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-version-hash-'));
  try {
    fs.mkdirSync(path.join(root, 'registry', 'worker-profiles', 'prompts'), { recursive: true });
    fs.cpSync(path.join(REPO, 'registry'), path.join(root, 'registry'), { recursive: true, force: true });
    fs.appendFileSync(path.join(root, 'registry', 'worker-profiles', 'prompts', 'engineer.md'), '\n<!-- hash probe -->\n');
    const after = computePromptVersionPair('engineer', 'balanced', { rootDir: root });
    assert.notEqual(before.fragmentHash, after.fragmentHash);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('evaluatePromptVersionGate bootstraps when no prior record exists', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-version-bootstrap-'));
  try {
    const result = evaluatePromptVersionGate({ rootDir: REPO, projectDir, bootstrap: true });
    assert.equal(result.pass, true);
    assert.equal(result.bootstrapped, true);
    const { record, exists } = readCertifiedPromptVersions({ rootDir: projectDir });
    assert.equal(exists, true);
    assert.ok(Object.keys(record.pairs).length >= 20);
    assert.ok(record.pairs[promptVersionPairKey('engineer', 'balanced')]);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('evaluatePromptVersionGate fails when stored hash drifts without recertification', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-version-stale-'));
  try {
    const baseline = evaluatePromptVersionGate({ rootDir: REPO, projectDir, bootstrap: true });
    assert.equal(baseline.pass, true);
    const { record } = readCertifiedPromptVersions({ rootDir: projectDir });
    const key = promptVersionPairKey('engineer', 'balanced');
    record.pairs[key].fragmentHash = '0'.repeat(64);
    fs.writeFileSync(
      path.join(projectDir, '.construct', 'certification', 'prompt-versions.json'),
      `${JSON.stringify(record, null, 2)}\n`,
    );
    const stale = evaluatePromptVersionGate({ rootDir: REPO, projectDir, bootstrap: false });
    assert.equal(stale.pass, false);
    assert.ok(stale.errors.some((err) => err.includes('engineer:balanced')));
    assert.ok(stale.stalePairs.some((pair) => pair.workerProfileId === 'engineer'));
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('evaluatePromptVersionGate ignores unrelated store drift when hashes still match', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-version-stable-'));
  try {
    const baseline = evaluatePromptVersionGate({ rootDir: REPO, projectDir, bootstrap: true });
    assert.equal(baseline.pass, true);
    fs.writeFileSync(path.join(projectDir, 'unrelated-change.txt'), 'no prompt impact\n');
    const again = evaluatePromptVersionGate({ rootDir: REPO, projectDir, bootstrap: false });
    assert.equal(again.pass, true);
    assert.equal(again.staleCount ?? 0, 0);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
