/**
 * tests/project-config.test.mjs — construct.config.json loader contract.
 *
 * Pins schema validation (required fields, enums, type checks), secret
 * interpolation (env-pointer strings resolve from process.env at load
 * time, never the literal `$VAR` value), path resolution (walk up to
 * git root), the env-over-config-over-default precedence rule, and the
 * deep-merge behavior so users can keep their config.json minimal and
 * still pick up defaults for unspecified branches.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  findProjectConfigPath,
  loadProjectConfig,
  writeProjectConfig,
  initProjectConfig,
  interpolateSecrets,
  getConfigValue,
  setConfigValue,
  resolveSetting,
  PROJECT_CONFIG_FILENAME,
  PROJECT_LOCAL_CONFIG_FILENAME,
} from '../lib/config/project-config.mjs';
import { DEFAULT_PROJECT_CONFIG, validateProjectConfig, CONFIG_SCHEMA_VERSION } from '../lib/config/schema.mjs';

let tmpRoot;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-config-'));
  fs.mkdirSync(path.join(tmpRoot, '.git'), { recursive: true });
});

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('validateProjectConfig', () => {
  it('accepts the default config shape', () => {
    const result = validateProjectConfig(DEFAULT_PROJECT_CONFIG);
    assert.equal(result.valid, true);
  });

  it('rejects when version is missing', () => {
    const result = validateProjectConfig({});
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('version: required')));
  });

  it('rejects when deployment.mode is outside the enum', () => {
    const result = validateProjectConfig({
      version: 1,
      deployment: { mode: 'cluster' },
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('deployment.mode')));
  });

  it('rejects when version mismatches the schema', () => {
    const result = validateProjectConfig({ version: 99 });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('version:')));
  });

  it('accepts additive future blocks (resources, costs) for forward-compat', () => {
    const result = validateProjectConfig({
      version: 1,
      resources: { disk: { tracesMaxDays: 30 } },
      costs: { providers: { openai: { dailyLimitUsd: 5 } } },
    });
    assert.equal(result.valid, true);
  });
});

describe('interpolateSecrets', () => {
  it('replaces $VAR pointers with env values', () => {
    const out = interpolateSecrets(
      { providers: { anthropic: { apiKey: '$ANTHROPIC_KEY' } } },
      { ANTHROPIC_KEY: 'sk-ant-abc' },
    );
    assert.equal(out.providers.anthropic.apiKey, 'sk-ant-abc');
  });

  it('returns null when the pointed-to env var is missing', () => {
    const out = interpolateSecrets({ k: '$MISSING_VAR' }, {});
    assert.equal(out.k, null);
  });

  it('leaves non-pointer strings untouched', () => {
    assert.equal(interpolateSecrets('plain-value', {}), 'plain-value');
    assert.equal(interpolateSecrets('$lowercase_var', {}), '$lowercase_var');
    assert.equal(interpolateSecrets('text with $VAR mid-string', {}), 'text with $VAR mid-string');
  });

  it('recurses into nested arrays + objects', () => {
    const out = interpolateSecrets(
      { items: ['$A', { nested: '$B' }] },
      { A: 'one', B: 'two' },
    );
    assert.deepEqual(out, { items: ['one', { nested: 'two' }] });
  });
});

describe('findProjectConfigPath', () => {
  it('returns null when no config file exists and walk hits git root', () => {
    const result = findProjectConfigPath(tmpRoot);
    assert.equal(result, null);
  });

  it('finds construct.config.json at project root', () => {
    const cfgPath = path.join(tmpRoot, PROJECT_CONFIG_FILENAME);
    fs.writeFileSync(cfgPath, JSON.stringify({ version: 1 }));
    try {
      assert.equal(findProjectConfigPath(tmpRoot), cfgPath);
    } finally {
      fs.unlinkSync(cfgPath);
    }
  });

  it('finds config when invoked from a deeper subdirectory', () => {
    const sub = path.join(tmpRoot, 'sub', 'deeper');
    fs.mkdirSync(sub, { recursive: true });
    const cfgPath = path.join(tmpRoot, PROJECT_CONFIG_FILENAME);
    fs.writeFileSync(cfgPath, JSON.stringify({ version: 1 }));
    try {
      assert.equal(findProjectConfigPath(sub), cfgPath);
    } finally {
      fs.unlinkSync(cfgPath);
      fs.rmSync(path.join(tmpRoot, 'sub'), { recursive: true });
    }
  });
});

describe('loadProjectConfig', () => {
  it('returns defaults with source=default when no file exists', () => {
    const result = loadProjectConfig(tmpRoot, {});
    assert.equal(result.source, 'default');
    assert.equal(result.path, null);
    assert.equal(result.config.alias, 'Construct');
    assert.equal(result.config.deployment.mode, 'solo');
    assert.equal(result.errors.length, 0);
  });

  it('merges file values over defaults', () => {
    const cfgPath = path.join(tmpRoot, PROJECT_CONFIG_FILENAME);
    fs.writeFileSync(cfgPath, JSON.stringify({
      version: 1,
      alias: 'Atlas',
      deployment: { mode: 'team' },
    }));
    try {
      const result = loadProjectConfig(tmpRoot, {});
      assert.equal(result.source, 'file');
      assert.equal(result.config.alias, 'Atlas');
      assert.equal(result.config.deployment.mode, 'team');
      assert.equal(result.config.deployment.mcpBroker, 'auto');
    } finally {
      fs.unlinkSync(cfgPath);
    }
  });

  it('resolves secret pointers during load', () => {
    const cfgPath = path.join(tmpRoot, PROJECT_CONFIG_FILENAME);
    fs.writeFileSync(cfgPath, JSON.stringify({
      version: 1,
      providers: { openai: { apiKey: '$OAI_KEY_TEST' } },
    }));
    try {
      const result = loadProjectConfig(tmpRoot, { OAI_KEY_TEST: 'sk-oai-test' });
      assert.equal(result.config.providers.openai.apiKey, 'sk-oai-test');
    } finally {
      fs.unlinkSync(cfgPath);
    }
  });

  it('reports parse errors with source=invalid and falls back to defaults', () => {
    const cfgPath = path.join(tmpRoot, PROJECT_CONFIG_FILENAME);
    fs.writeFileSync(cfgPath, '{ this is not json');
    try {
      const result = loadProjectConfig(tmpRoot, {});
      assert.equal(result.source, 'invalid');
      assert.equal(result.config.alias, 'Construct');
      assert.ok(result.errors[0].includes('failed to parse'));
    } finally {
      fs.unlinkSync(cfgPath);
    }
  });

  it('reports schema errors with source=invalid', () => {
    const cfgPath = path.join(tmpRoot, PROJECT_CONFIG_FILENAME);
    fs.writeFileSync(cfgPath, JSON.stringify({ version: 1, deployment: { mode: 'invalid' } }));
    try {
      const result = loadProjectConfig(tmpRoot, {});
      assert.equal(result.source, 'invalid');
      assert.ok(result.errors.some((e) => e.includes('deployment.mode')));
    } finally {
      fs.unlinkSync(cfgPath);
    }
  });
});

describe('writeProjectConfig + initProjectConfig', () => {
  it('refuses to write an invalid config', () => {
    const cfgPath = path.join(tmpRoot, PROJECT_CONFIG_FILENAME);
    assert.throws(
      () => writeProjectConfig(cfgPath, { version: 1, deployment: { mode: 'bogus' } }),
      /refusing to write invalid config/,
    );
  });

  it('writes a valid config and round-trips through load', () => {
    const cfgPath = path.join(tmpRoot, PROJECT_CONFIG_FILENAME);
    writeProjectConfig(cfgPath, { ...DEFAULT_PROJECT_CONFIG, alias: 'Atlas' });
    try {
      const loaded = loadProjectConfig(tmpRoot, {});
      assert.equal(loaded.config.alias, 'Atlas');
    } finally {
      fs.unlinkSync(cfgPath);
    }
  });

  it('refuses to write an invalid writes.policy block', () => {
    const cfgPath = path.join(tmpRoot, PROJECT_CONFIG_FILENAME);
    assert.throws(
      () => writeProjectConfig(cfgPath, { ...DEFAULT_PROJECT_CONFIG, writes: { policy: { 'jira.issue': 'sometimes' } } }),
      /refusing to write invalid config/,
    );
  });

  it('writes a valid writes.policy block and round-trips through load', () => {
    const cfgPath = path.join(tmpRoot, PROJECT_CONFIG_FILENAME);
    writeProjectConfig(cfgPath, { ...DEFAULT_PROJECT_CONFIG, writes: { policy: { 'jira.comment': 'auto' } } });
    try {
      const loaded = loadProjectConfig(tmpRoot, {});
      assert.equal(loaded.config.writes.policy['jira.comment'], 'auto');
    } finally {
      fs.unlinkSync(cfgPath);
    }
  });

  it('strict-mode write recognizes writes + directives as known fields and round-trips both unchanged', () => {
    const cfgPath = path.join(tmpRoot, PROJECT_CONFIG_FILENAME);
    const config = {
      ...DEFAULT_PROJECT_CONFIG,
      writes: { policy: { 'jira.comment': 'auto', 'slack.message': 'approval' } },
      directives: [
        {
          id: 'watch-jira-roadmap',
          provider: 'jira',
          specialist: 'cx-researcher',
          instruction: 'Watch Jira, summarize what the team is working on.',
          trigger: { kind: 'interval', intervalMinutes: 1440 },
          action: 'summarize',
          output: { kind: 'knowledge-note' },
          autoRun: false,
        },
      ],
    };
    // strict:true throws on unknown top-level fields — this call proves
    // writes/directives are recognized, not just tolerated in non-strict mode.
    writeProjectConfig(cfgPath, config, { strict: true });
    try {
      const onDisk = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      assert.deepEqual(onDisk.writes, config.writes);
      assert.deepEqual(onDisk.directives, config.directives);
      const loaded = loadProjectConfig(tmpRoot, {});
      assert.equal(loaded.config.writes.policy['jira.comment'], 'auto');
      assert.equal(loaded.config.directives[0].id, 'watch-jira-roadmap');
    } finally {
      fs.unlinkSync(cfgPath);
    }
  });

  it('initProjectConfig refuses to overwrite an existing file', () => {
    const cfgPath = path.join(tmpRoot, PROJECT_CONFIG_FILENAME);
    fs.writeFileSync(cfgPath, '{}');
    try {
      assert.throws(() => initProjectConfig(tmpRoot), /already exists/);
    } finally {
      fs.unlinkSync(cfgPath);
    }
  });
});

describe('getConfigValue + setConfigValue', () => {
  it('reads nested values by dotted path', () => {
    const cfg = { a: { b: { c: 42 } } };
    assert.equal(getConfigValue(cfg, 'a.b.c'), 42);
    assert.equal(getConfigValue(cfg, 'a.missing.path', 'fallback'), 'fallback');
  });

  it('writes nested values by dotted path, creating missing intermediates', () => {
    const before = { existing: true };
    const after = setConfigValue(before, 'deployment.mode', 'team');
    assert.equal(after.deployment.mode, 'team');
    assert.equal(after.existing, true);
    assert.equal(before.deployment, undefined);
  });
});

describe('project-local config tier', () => {
  function writeBoth(committed, local) {
    fs.writeFileSync(path.join(tmpRoot, PROJECT_CONFIG_FILENAME), JSON.stringify(committed));
    if (local !== undefined) {
      fs.writeFileSync(path.join(tmpRoot, PROJECT_LOCAL_CONFIG_FILENAME), JSON.stringify(local));
    }
  }
  function cleanup() {
    for (const f of [PROJECT_CONFIG_FILENAME, PROJECT_LOCAL_CONFIG_FILENAME]) {
      try { fs.unlinkSync(path.join(tmpRoot, f)); } catch {}
    }
  }

  it('overrides scalars and leaves untouched scalars intact', () => {
    writeBoth(
      { version: 1, alias: 'Committed', intakePolicy: { maxDepth: 4, additionalDirs: ['docs'] } },
      { alias: 'LocalOverride' },
    );
    try {
      const r = loadProjectConfig(tmpRoot, {});
      assert.equal(r.source, 'file+local');
      assert.equal(r.config.alias, 'LocalOverride');
      assert.equal(r.config.intakePolicy.maxDepth, 4);
    } finally {
      cleanup();
    }
  });

  it('merges and dedupes scalar list settings', () => {
    writeBoth(
      { version: 1, intakePolicy: { additionalDirs: ['docs', 'specs'] } },
      { intakePolicy: { additionalDirs: ['inbox', 'docs'] } },
    );
    try {
      const r = loadProjectConfig(tmpRoot, {});
      assert.deepEqual(r.config.intakePolicy.additionalDirs, ['docs', 'specs', 'inbox']);
    } finally {
      cleanup();
    }
  });

  it('merges object lists by id, with the local entry winning on collision', () => {
    writeBoth(
      { version: 1, sources: { targets: [{ id: 'gh-main', provider: 'github', selector: { repo: 'org/a' } }] } },
      { sources: { targets: [
        { id: 'gh-main', provider: 'github', selector: { repo: 'org/a-local' } },
        { id: 'gh-extra', provider: 'github', selector: { repo: 'org/b' } },
      ] } },
    );
    try {
      const r = loadProjectConfig(tmpRoot, {});
      const ids = r.config.sources.targets.map((t) => t.id);
      assert.deepEqual(ids, ['gh-main', 'gh-extra']);
      assert.equal(r.config.sources.targets.find((t) => t.id === 'gh-main').selector.repo, 'org/a-local');
    } finally {
      cleanup();
    }
  });

  it('accepts a partial local overlay without a version field', () => {
    writeBoth({ version: 1, alias: 'Committed' }, { deployment: { mode: 'team' } });
    try {
      const r = loadProjectConfig(tmpRoot, {});
      assert.equal(r.config.deployment.mode, 'team');
      assert.equal(r.errors.length, 0);
    } finally {
      cleanup();
    }
  });

  it('reports source=invalid when the local overlay fails schema validation', () => {
    writeBoth({ version: 1 }, { deployment: { mode: 'bogus' } });
    try {
      const r = loadProjectConfig(tmpRoot, {});
      assert.equal(r.source, 'invalid');
      assert.ok(r.errors.some((e) => e.includes('deployment.mode')));
    } finally {
      cleanup();
    }
  });

  it('keeps source=file when no local overlay is present', () => {
    writeBoth({ version: 1, alias: 'Committed' }, undefined);
    try {
      const r = loadProjectConfig(tmpRoot, {});
      assert.equal(r.source, 'file');
    } finally {
      cleanup();
    }
  });
});

describe('resolveSetting precedence', () => {
  const config = { deployment: { mode: 'team' } };

  it('env wins when set', () => {
    const r = resolveSetting({
      config,
      jsonPath: 'deployment.mode',
      env: { CONSTRUCT_DEPLOYMENT_MODE: 'enterprise' },
      envKey: 'CONSTRUCT_DEPLOYMENT_MODE',
      defaultValue: 'solo',
    });
    assert.equal(r.value, 'enterprise');
    assert.equal(r.source, 'env');
  });

  it('config wins over default when env is empty/unset', () => {
    const r = resolveSetting({
      config,
      jsonPath: 'deployment.mode',
      env: { CONSTRUCT_DEPLOYMENT_MODE: '' },
      envKey: 'CONSTRUCT_DEPLOYMENT_MODE',
      defaultValue: 'solo',
    });
    assert.equal(r.value, 'team');
    assert.equal(r.source, 'config');
  });

  it('default wins when neither env nor config has a value', () => {
    const r = resolveSetting({
      config: {},
      jsonPath: 'deployment.mode',
      env: {},
      envKey: 'CONSTRUCT_DEPLOYMENT_MODE',
      defaultValue: 'solo',
    });
    assert.equal(r.value, 'solo');
    assert.equal(r.source, 'default');
  });
});
