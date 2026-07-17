/**
 * tests/oracle/read-model-directives.test.mjs — construct-p4cba.6 (WS-B5)
 * collectReadModel's `directives` section: which configured directives are
 * due, agreeing with the same due-tracker state
 * lib/embed/daemon.mjs's directive-runner job reads and advances.
 */

import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import { collectReadModel } from '../../lib/oracle/read-model.mjs';
import { writeDirectiveState } from '../../lib/directives/due-tracker.mjs';
import { doctorRoot } from '../../lib/config/xdg.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

// readDirectiveState (via collectReadModel's directives section) resolves
// through the machine-scoped state root (ADR-0066, lib/state-root.mjs) —
// CX_HOME_OVERRIDE keeps that off the real developer machine's $HOME for
// the whole file (same isolation as tests/orchestration/provenance.test.mjs).

const homeOverride = mkdtempSync(join(tmpdir(), 'cx-read-model-directives-home-'));
const prevHomeOverride = process.env.CX_HOME_OVERRIDE;
process.env.CX_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
});

function freshEnv() {
  const projectDir = mkdtempSync(join(tmpdir(), 'construct-oracle-directives-proj-'));
  const homeDir = mkdtempSync(join(tmpdir(), 'construct-oracle-directives-home-'));
  const rootDir = mkdtempSync(join(tmpdir(), 'construct-oracle-directives-root-'));
  mkdirSync(join(projectDir, '.construct', 'observations'), { recursive: true });
  mkdirSync(join(projectDir, '.construct', 'outcomes'), { recursive: true });
  mkdirSync(join(rootDir, 'audit-artifacts'), { recursive: true });
  mkdirSync(doctorRoot(homeDir), { recursive: true });
  mkdirSync(join(rootDir, 'specialists'), { recursive: true });
  cpSync(join(process.cwd(), 'specialists', 'org'), join(rootDir, 'specialists', 'org'), { recursive: true });
  return {
    projectDir,
    homeDir,
    rootDir,
    cleanup() {
      for (const d of [projectDir, homeDir, rootDir]) {
        try { rmTmpDir(d); } catch { /* ignore */ }
      }
    },
  };
}

function writeDirectivesConfig(projectDir, directives) {
  writeFileSync(join(projectDir, 'construct.config.json'), JSON.stringify({ version: 1, directives }));
}

test('directives.due is empty with no configured directives', () => {
  const env = freshEnv();
  try {
    const model = collectReadModel(env);
    assert.equal(model.directives.present, false);
    assert.deepEqual(model.directives.due, []);
  } finally {
    env.cleanup();
  }
});

test('a directive with no prior run state is due', () => {
  const env = freshEnv();
  try {
    writeDirectivesConfig(env.projectDir, [{
      id: 'jira-weekly-summary', provider: 'team-jira', specialist: 'cx-operations',
      instruction: 'Summarize open Jira work', trigger: { kind: 'interval', intervalMinutes: 60 },
      action: 'summarize', output: { kind: 'beads' },
    }]);

    const model = collectReadModel(env);
    assert.equal(model.directives.present, true);
    assert.equal(model.directives.due.length, 1);
    assert.equal(model.directives.due[0].id, 'jira-weekly-summary');
  } finally {
    env.cleanup();
  }
});

test('a directive run within its interval is not due', () => {
  const env = freshEnv();
  try {
    writeDirectivesConfig(env.projectDir, [{
      id: 'jira-weekly-summary', provider: 'team-jira', specialist: 'cx-operations',
      instruction: 'Summarize open Jira work', trigger: { kind: 'interval', intervalMinutes: 60 },
      action: 'summarize', output: { kind: 'beads' },
    }]);
    writeDirectiveState(env.projectDir, 'jira-weekly-summary', { lastRunAt: new Date().toISOString() });

    const model = collectReadModel(env);
    assert.deepEqual(model.directives.due, []);
  } finally {
    env.cleanup();
  }
});

test('a directive naming an unknown specialist is excluded, not surfaced as a false due signal', () => {
  const env = freshEnv();
  try {
    writeDirectivesConfig(env.projectDir, [{
      id: 'bad-directive', provider: 'team-jira', specialist: 'cx-not-a-real-role',
      instruction: 'do something', trigger: { kind: 'interval', intervalMinutes: 60 },
      action: 'summarize', output: { kind: 'beads' },
    }]);

    const model = collectReadModel(env);
    assert.deepEqual(model.directives.due, []);
  } finally {
    env.cleanup();
  }
});
