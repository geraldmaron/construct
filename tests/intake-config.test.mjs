/**
 * tests/intake-config.test.mjs — intake config schema, persistence, env merge.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';

import {
  loadIntakeConfig,
  saveIntakeConfig,
  describeIntakeDepth,
  INTAKE_DEFAULT_MAX_DEPTH,
  INTAKE_HARD_MAX_DEPTH,
  INTAKE_DEPTH_GUIDANCE,
} from '../lib/intake/intake-config.mjs';
import { writeProjectConfig, PROJECT_CONFIG_FILENAME } from '../lib/config/project-config.mjs';
import { DEFAULT_PROJECT_CONFIG } from '../lib/config/schema.mjs';

let projectRoot;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-intake-config-'));
  fs.mkdirSync(path.join(projectRoot, '.cx'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
  writeProjectConfig(path.join(projectRoot, PROJECT_CONFIG_FILENAME), { ...DEFAULT_PROJECT_CONFIG });
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

describe('loadIntakeConfig', () => {
  it('returns single-zone defaults (only inbox/) when no config exists', () => {
    const cfg = loadIntakeConfig(projectRoot, {});
    assert.equal(cfg.maxDepth, INTAKE_DEFAULT_MAX_DEPTH);
    assert.deepEqual(cfg.parentDirs, []);
    assert.equal('includeProjectInbox' in cfg, false, 'no deprecated zone fields in the config shape');
    assert.equal('includeDocsIntake' in cfg, false, 'no deprecated zone fields in the config shape');
  });

  it('reads parentDirs and maxDepth from project config intakePolicy', () => {
    writeProjectConfig(path.join(projectRoot, PROJECT_CONFIG_FILENAME), {
      version: 1,
      intakePolicy: { additionalDirs: ['/tmp/a'], maxDepth: 2 },
    });
    const cfg = loadIntakeConfig(projectRoot, {});
    assert.equal(cfg.maxDepth, 2);
    assert.deepEqual(cfg.parentDirs, ['/tmp/a']);
  });

  it('merges CX_INBOX_DIRS env into parentDirs without dupes', () => {
    writeProjectConfig(path.join(projectRoot, PROJECT_CONFIG_FILENAME), {
      version: 1,
      intakePolicy: { additionalDirs: ['/tmp/a'] },
    });
    const cfg = loadIntakeConfig(projectRoot, { CX_INBOX_DIRS: '/tmp/a:/tmp/b' });
    assert.deepEqual(cfg.parentDirs, ['/tmp/a', '/tmp/b']);
  });

  it('CX_INTAKE_MAX_DEPTH env wins over project config', () => {
    writeProjectConfig(path.join(projectRoot, PROJECT_CONFIG_FILENAME), {
      version: 1,
      intakePolicy: { maxDepth: 1 },
    });
    const cfg = loadIntakeConfig(projectRoot, { CX_INTAKE_MAX_DEPTH: '5' });
    assert.equal(cfg.maxDepth, 5);
  });

  it('clamps maxDepth to the hard limit', () => {
    writeProjectConfig(path.join(projectRoot, PROJECT_CONFIG_FILENAME), {
      version: 1,
      intakePolicy: { maxDepth: 999 },
    });
    const cfg = loadIntakeConfig(projectRoot, {});
    assert.equal(cfg.maxDepth, INTAKE_HARD_MAX_DEPTH);
  });

  it('rejects negative depth (falls back to default)', () => {
    writeProjectConfig(path.join(projectRoot, PROJECT_CONFIG_FILENAME), {
      version: 1,
      intakePolicy: { maxDepth: -3 },
    });
    const cfg = loadIntakeConfig(projectRoot, {});
    assert.equal(cfg.maxDepth, INTAKE_DEFAULT_MAX_DEPTH);
  });
});

describe('saveIntakeConfig', () => {
  it('persists patch to construct.config.json intakePolicy', () => {
    saveIntakeConfig(projectRoot, { maxDepth: 2, parentDirs: ['/tmp/x'] });
    const saved = JSON.parse(
      fs.readFileSync(path.join(projectRoot, PROJECT_CONFIG_FILENAME), 'utf8'),
    );
    assert.equal(saved.intakePolicy.maxDepth, 2);
    assert.deepEqual(saved.intakePolicy.additionalDirs, ['/tmp/x']);
  });

  it('preserves untouched fields on a partial save', () => {
    saveIntakeConfig(projectRoot, { maxDepth: 8, parentDirs: ['/tmp/keep'] });
    saveIntakeConfig(projectRoot, { maxDepth: 6 });
    const cfg = loadIntakeConfig(projectRoot, {});
    assert.equal(cfg.maxDepth, 6);
    assert.deepEqual(cfg.parentDirs, ['/tmp/keep'], 'additionalDirs survive a depth-only save');
  });

  it('refuses to write in an uninitialized project', () => {
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-uninit-'));
    try {
      assert.throws(() => saveIntakeConfig(fresh, { maxDepth: 2 }), /Refusing to write/);
    } finally {
      fs.rmSync(fresh, { recursive: true, force: true });
    }
  });
});

describe('describeIntakeDepth', () => {
  it('returns the canonical guidance entry for known stops', () => {
    const four = describeIntakeDepth(4);
    assert.equal(four.value, 4);
    assert.match(four.label, /default/i);
  });

  it('synthesizes a label for custom depths', () => {
    const custom = describeIntakeDepth(5);
    assert.equal(custom.value, 5);
    assert.match(custom.label, /Custom/);
  });

  it('every guidance entry has the required shape', () => {
    for (const g of INTAKE_DEPTH_GUIDANCE) {
      assert.equal(typeof g.value, 'number');
      assert.equal(typeof g.label, 'string');
      assert.equal(typeof g.detail, 'string');
    }
  });
});
