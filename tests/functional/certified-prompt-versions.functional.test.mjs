/**
 * tests/functional/certified-prompt-versions.functional.test.mjs — release gate prompt-version enforcement.
 *
 * Uses real prompt composition and an isolated .construct/certification store to prove
 * fragment edits block release until worker-profile re-certification, while unrelated
 * file changes do not.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { evaluatePromptVersionGate } from '../../lib/certification/prompt-versions.mjs';
import { writeCertificationRun } from '../../lib/certification/store.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function makePromptFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cert-prompt-fixture-'));
  fs.mkdirSync(path.join(root, 'registry'), { recursive: true });
  fs.mkdirSync(path.join(root, 'skills', 'perspectives'), { recursive: true });
  fs.cpSync(path.join(REPO, 'registry'), path.join(root, 'registry'), { recursive: true });
  fs.cpSync(path.join(REPO, 'skills', 'perspectives'), path.join(root, 'skills', 'perspectives'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ name: 'prompt-version-fixture' }, null, 2)}\n`);
  return root;
}

test('first gate run bootstraps certified prompt-version history', () => {
  const root = makePromptFixtureRoot();
  try {
    const result = evaluatePromptVersionGate({ rootDir: root, projectDir: root, bootstrap: true });
    assert.equal(result.pass, true, result.errors.join('\n'));
    assert.equal(result.bootstrapped, true);
    assert.ok(fs.existsSync(path.join(root, '.construct', 'certification', 'prompt-versions.json')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('role-flavor fragment edit blocks release until re-certification', () => {
  const root = makePromptFixtureRoot();
  try {
    const boot = evaluatePromptVersionGate({ rootDir: root, projectDir: root, bootstrap: true });
    assert.equal(boot.pass, true);

    fs.appendFileSync(path.join(root, 'skills', 'perspectives', 'engineer.md'), '\n<!-- release gate probe -->\n');

    const blocked = evaluatePromptVersionGate({ rootDir: root, projectDir: root, bootstrap: false });
    assert.equal(blocked.pass, false);
    assert.ok(blocked.stalePairs.some((pair) => pair.workerProfileId === 'engineer'));

    writeCertificationRun({
      schemaVersion: 1,
      id: 'cert-prompt-recert-engineer',
      scenarioId: 'worker-profile.happy-path-representative.engineer',
      capabilityId: 'worker-profile.prompt',
      evidenceVersion: 'v1',
      createdAt: new Date().toISOString(),
      model: {
        provider: 'hermetic',
        requestedId: 'hermetic',
        resolvedId: 'hermetic',
        tier: 'hermetic',
        paidOptIn: false,
        operatorAckAt: null,
      },
      fixture: {
        path: 'tests/certification/scenarios/worker-profiles/engineer/happy-path-representative.json',
        sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      verdict: { status: 'pass', source: 'deterministic', reason: null },
      gates: [{ id: 'worker-profile-representative-engineer', type: 'worker-profile-scenario-audit', pass: true }],
      timing: { latencyMs: 5 },
    }, { rootDir: root });

    const cleared = evaluatePromptVersionGate({ rootDir: root, projectDir: root, bootstrap: false });
    assert.equal(cleared.pass, true, cleared.errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('unrelated file edits do not trigger prompt re-certification', () => {
  const root = makePromptFixtureRoot();
  try {
    const boot = evaluatePromptVersionGate({ rootDir: root, projectDir: root, bootstrap: true });
    assert.equal(boot.pass, true);

    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'unrelated.txt'), 'no prompt fragments here\n');

    const result = evaluatePromptVersionGate({ rootDir: root, projectDir: root, bootstrap: false });
    assert.equal(result.pass, true, result.errors.join('\n'));
    assert.equal(result.staleCount ?? 0, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
