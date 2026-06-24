/**
 * tests/intake-policy.test.mjs — project-config intakePolicy resolution.
 *
 * Single-zone model (ADR-0045 §C): the only drop zone is the project-root
 * `inbox/`. The policy carries maxDepth and additionalDirs — no zone fields.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';
import {
  loadIntakePolicy,
  saveIntakePolicy,
  resolvedIntakeConfig,
  DEFAULT_INTAKE_POLICY,
} from '../lib/config/intake-policy.mjs';
import { writeProjectConfig, PROJECT_CONFIG_FILENAME } from '../lib/config/project-config.mjs';
import { DEFAULT_PROJECT_CONFIG } from '../lib/config/schema.mjs';

let projectRoot;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-intake-policy-'));
  fs.mkdirSync(path.join(projectRoot, '.cx'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
  writeProjectConfig(path.join(projectRoot, PROJECT_CONFIG_FILENAME), {
    ...DEFAULT_PROJECT_CONFIG,
    intakePolicy: DEFAULT_INTAKE_POLICY,
  });
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

describe('loadIntakePolicy', () => {
  it('resolves the single-zone default (inbox/ only, depth 4)', () => {
    const policy = loadIntakePolicy(projectRoot, {});
    assert.equal(policy.source, 'project-config');
    assert.equal(policy.maxDepth, 4);
    assert.deepEqual(policy.additionalDirs, []);
    assert.equal('zones' in policy, false, 'no zone model in the resolved policy');
  });

  it('carries additionalDirs and maxDepth from project config', () => {
    writeProjectConfig(path.join(projectRoot, PROJECT_CONFIG_FILENAME), {
      ...DEFAULT_PROJECT_CONFIG,
      intakePolicy: { maxDepth: 2, additionalDirs: ['/tmp/extra'] },
    });
    const policy = loadIntakePolicy(projectRoot, {});
    assert.equal(policy.maxDepth, 2);
    assert.deepEqual(policy.additionalDirs, ['/tmp/extra']);
  });

  it('merges CX_INBOX_DIRS env dirs with config additionalDirs (deduped)', () => {
    writeProjectConfig(path.join(projectRoot, PROJECT_CONFIG_FILENAME), {
      ...DEFAULT_PROJECT_CONFIG,
      intakePolicy: { maxDepth: 4, additionalDirs: ['/tmp/a'] },
    });
    const policy = loadIntakePolicy(projectRoot, { CX_INBOX_DIRS: '/tmp/a:/tmp/b' });
    assert.deepEqual(policy.additionalDirs, ['/tmp/a', '/tmp/b']);
  });

  it('falls back to the single-zone default when project config has no intakePolicy', () => {
    fs.writeFileSync(
      path.join(projectRoot, PROJECT_CONFIG_FILENAME),
      JSON.stringify({ version: 1 }),
    );
    const policy = loadIntakePolicy(projectRoot, {});
    assert.equal(policy.source, 'default');
    assert.equal(policy.maxDepth, DEFAULT_INTAKE_POLICY.maxDepth);
    assert.deepEqual(policy.additionalDirs, []);
    assert.equal('legacyWarning' in policy, false, 'no legacy warning field on the resolved policy');
  });
});

describe('saveIntakePolicy', () => {
  it('persists maxDepth and additionalDirs to construct.config.json', () => {
    saveIntakePolicy(projectRoot, { maxDepth: 6, additionalDirs: ['/tmp/z'] });
    const cfg = resolvedIntakeConfig(projectRoot, {});
    assert.equal(cfg.maxDepth, 6);
    assert.deepEqual(cfg.parentDirs, ['/tmp/z']);
  });

  it('does not persist any zone fields', () => {
    saveIntakePolicy(projectRoot, { maxDepth: 5 });
    const written = JSON.parse(fs.readFileSync(path.join(projectRoot, PROJECT_CONFIG_FILENAME), 'utf8'));
    assert.equal('zones' in written.intakePolicy, false, 'intakePolicy carries no zones object');
  });
});
