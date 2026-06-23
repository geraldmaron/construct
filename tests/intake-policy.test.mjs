/**
 * tests/intake-policy.test.mjs — project-config intakePolicy resolution.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';
import {
  loadIntakePolicy,
  saveIntakePolicy,
  migrateLegacyIntakeConfig,
  DEFAULT_INTAKE_POLICY,
} from '../lib/config/intake-policy.mjs';
import { writeProjectConfig, PROJECT_CONFIG_FILENAME } from '../lib/config/project-config.mjs';
import { DEFAULT_PROJECT_CONFIG } from '../lib/config/schema.mjs';
import { resolvedIntakeConfig } from '../lib/config/intake-policy.mjs';

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
  it('reads zones and depth from construct.config.json', () => {
    const policy = loadIntakePolicy(projectRoot, {});
    assert.equal(policy.source, 'project-config');
    assert.equal(policy.zones.rootInbox, true);
    assert.equal(policy.zones.projectInbox, true);
    assert.equal(policy.maxDepth, 4);
  });

  it('falls back to legacy intake-config with warning metadata', () => {
    fs.writeFileSync(
      path.join(projectRoot, PROJECT_CONFIG_FILENAME),
      JSON.stringify({ version: 1 }),
    );
    fs.writeFileSync(
      path.join(projectRoot, '.cx', 'intake-config.json'),
      JSON.stringify({ maxDepth: 2, includeArchetypeInbox: true, parentDirs: ['/tmp/x'] }),
    );
    const policy = loadIntakePolicy(projectRoot, {});
    assert.equal(policy.source, 'legacy-intake-config');
    assert.ok(policy.legacyWarning);
    assert.equal(policy.maxDepth, 2);
    assert.equal(policy.zones.rootInbox, true);
    assert.deepEqual(policy.additionalDirs, ['/tmp/x']);
  });
});

describe('saveIntakePolicy', () => {
  it('persists intakePolicy to construct.config.json', () => {
    saveIntakePolicy(projectRoot, { maxDepth: 6, rootInbox: false });
    const cfg = resolvedIntakeConfig(projectRoot, {});
    assert.equal(cfg.maxDepth, 6);
    assert.equal(cfg.includeRootInbox, false);
  });
});

describe('migrateLegacyIntakeConfig', () => {
  it('copies legacy file into project config', () => {
    fs.writeFileSync(
      path.join(projectRoot, PROJECT_CONFIG_FILENAME),
      JSON.stringify({ version: 1 }),
    );
    fs.writeFileSync(
      path.join(projectRoot, '.cx', 'intake-config.json'),
      JSON.stringify({ maxDepth: 3, includeDocsIntake: false, parentDirs: [] }),
    );
    const result = migrateLegacyIntakeConfig(projectRoot);
    assert.equal(result.migrated, true);
    const cfg = resolvedIntakeConfig(projectRoot, {});
    assert.equal(cfg.maxDepth, 3);
    assert.equal(cfg.includeDocsIntake, false);
  });
});
