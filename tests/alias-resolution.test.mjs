/**
 * tests/alias-resolution.test.mjs — alias precedence + template.
 *
 * Pins env > user-level (~/.construct/config.json.aliasOverride) >
 * project (construct.config.json.alias) > 'Construct'. Also pins the
 * {{alias}} template substitution and the fallback when alias is
 * empty / whitespace.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveAlias, applyAliasToTemplate, DEFAULT_ALIAS } from '../lib/config/alias.mjs';

let projectRoot;
let fakeHome;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-alias-proj-'));
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-alias-home-'));
  fs.mkdirSync(path.join(projectRoot, '.git'));
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
  fs.rmSync(fakeHome, { recursive: true, force: true });
});

function writeProjectAlias(value) {
  fs.writeFileSync(path.join(projectRoot, 'construct.config.json'), JSON.stringify({
    version: 1,
    alias: value,
  }));
}

function writeUserOverride(value) {
  fs.mkdirSync(path.join(fakeHome, '.construct'), { recursive: true });
  fs.writeFileSync(path.join(fakeHome, '.construct', 'config.json'), JSON.stringify({
    aliasOverride: value,
  }));
}

describe('resolveAlias precedence', () => {
  it('returns the default when nothing is set', () => {
    const r = resolveAlias({ cwd: projectRoot, env: {}, homeDir: fakeHome });
    assert.equal(r.value, DEFAULT_ALIAS);
    assert.equal(r.source, 'default');
  });

  it('project config wins when no user-level override or env is set', () => {
    writeProjectAlias('Atlas');
    const r = resolveAlias({ cwd: projectRoot, env: {}, homeDir: fakeHome });
    assert.equal(r.value, 'Atlas');
    assert.equal(r.source, 'project');
  });

  it('user-level override wins over project config', () => {
    writeProjectAlias('Atlas');
    writeUserOverride('Prometheus');
    const r = resolveAlias({ cwd: projectRoot, env: {}, homeDir: fakeHome });
    assert.equal(r.value, 'Prometheus');
    assert.equal(r.source, 'user');
  });

  it('CONSTRUCT_ALIAS env var wins over everything', () => {
    writeProjectAlias('Atlas');
    writeUserOverride('Prometheus');
    const r = resolveAlias({
      cwd: projectRoot,
      env: { CONSTRUCT_ALIAS: 'Hermes' },
      homeDir: fakeHome,
    });
    assert.equal(r.value, 'Hermes');
    assert.equal(r.source, 'env');
  });

  it('falls through whitespace-only values', () => {
    writeProjectAlias('   ');
    const r = resolveAlias({ cwd: projectRoot, env: {}, homeDir: fakeHome });
    assert.equal(r.value, DEFAULT_ALIAS);
    assert.equal(r.source, 'default');
  });

  it('trims surrounding whitespace from the resolved alias', () => {
    writeProjectAlias('  Atlas  ');
    const r = resolveAlias({ cwd: projectRoot, env: {}, homeDir: fakeHome });
    assert.equal(r.value, 'Atlas');
  });
});

describe('applyAliasToTemplate', () => {
  it('replaces all {{alias}} occurrences with the resolved name', () => {
    const out = applyAliasToTemplate('I am {{alias}}, and {{alias}} routes everything.', 'Atlas');
    assert.equal(out, 'I am Atlas, and Atlas routes everything.');
  });

  it('returns the input unchanged when no token is present', () => {
    assert.equal(applyAliasToTemplate('no token here', 'Atlas'), 'no token here');
  });

  it('falls back to the default alias when the value is empty', () => {
    assert.equal(applyAliasToTemplate('hi {{alias}}', ''), `hi ${DEFAULT_ALIAS}`);
    assert.equal(applyAliasToTemplate('hi {{alias}}', '   '), `hi ${DEFAULT_ALIAS}`);
  });

  it('returns non-string input unchanged', () => {
    assert.equal(applyAliasToTemplate(undefined, 'Atlas'), undefined);
    assert.equal(applyAliasToTemplate(null, 'Atlas'), null);
  });
});
