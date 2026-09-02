/**
 * tests/kernel/project/config.test.ts — five tiers, each explained.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  explainConfig, resolveConfig, configFlagsFrom, validateUserDefaults, CONFIG_KEYS, CONFIG_TIERS, userDefaultsPath,
} from '../../../src/kernel/project/config.ts';
import { ProjectFileError } from '../../../src/kernel/project/files.ts';

const user = { path: '/home/u/.config/construct/config.json', values: { locale: 'fr-FR', color: 'never' } };
const project = { path: '/repo/.construct/project.json', behavior: { locale: 'de-DE', 'review.cadence': 'weekly' } };

test('with nothing set every key is its built-in default, and says so', () => {
  for (const r of resolveConfig({})) {
    assert.equal(r.source, 'built-in default');
    assert.equal(r.origin, 'built-in');
    assert.ok(r.description.length > 0);
  }
  assert.deepEqual(CONFIG_TIERS, ['built-in default', 'user defaults', 'project config', 'environment', 'flag']);
});

test('each tier overrides the one below it and explain lists every candidate', () => {
  const only = explainConfig({ userDefaults: user }, 'locale');
  assert.equal(only.effective.value, 'fr-FR');
  assert.equal(only.effective.source, 'user defaults');

  const withProject = explainConfig({ userDefaults: user, projectConfig: project }, 'locale');
  assert.equal(withProject.effective.value, 'de-DE');
  assert.equal(withProject.effective.origin, project.path);

  const withEnv = explainConfig({ userDefaults: user, projectConfig: project, env: { CONSTRUCT_LOCALE: 'es-ES' } }, 'locale');
  assert.equal(withEnv.effective.source, 'environment');
  assert.equal(withEnv.effective.origin, 'CONSTRUCT_LOCALE');

  const withFlag = explainConfig({ userDefaults: user, projectConfig: project, env: { CONSTRUCT_LOCALE: 'es-ES' }, flags: { '--locale': 'it-IT' } }, 'locale');
  assert.equal(withFlag.effective.value, 'it-IT');
  assert.equal(withFlag.effective.source, 'flag');
  assert.deepEqual(withFlag.candidates.map((c) => [c.source, c.value]), [
    ['built-in default', 'en-US'], ['user defaults', 'fr-FR'], ['project config', 'de-DE'], ['environment', 'es-ES'], ['flag', 'it-IT'],
  ]);
});

test('a tier that may not set a key is ignored for that key', () => {
  // color is presentation: the project cannot set it even if a value is present.
  const color = explainConfig({ userDefaults: user, projectConfig: { path: project.path, behavior: { color: 'always' } } }, 'color');
  assert.equal(color.effective.value, 'never');
  assert.equal(color.effective.source, 'user defaults');
  // review.cadence is project policy: user defaults cannot set it.
  const cadence = explainConfig({ userDefaults: { path: user.path, values: { 'review.cadence': 'weekly' } }, projectConfig: project }, 'review.cadence');
  assert.equal(cadence.candidates.some((c) => c.source === 'user defaults'), false);
  assert.equal(cadence.effective.value, 'weekly');
  assert.equal(cadence.effective.source, 'project config');
  // and an env var for a key with no env tier does nothing.
  const policy = explainConfig({ env: { CONSTRUCT_POLICY_PROJECTWRITE: 'never' } }, 'policy.projectWrite');
  assert.equal(policy.effective.value, 'managed');
});

test('environment and flag values are validated like file values', () => {
  assert.throws(() => explainConfig({ env: { CONSTRUCT_LOCALE: 'not a locale!' } }, 'locale'), /language tag/);
  assert.throws(() => explainConfig({ flags: { '--color': 'sometimes' } }, 'color'), /must be one of auto \| always \| never/);
  assert.throws(() => explainConfig({ env: { CONSTRUCT_HEADLESS_EXECUTOR: '../bin/run' } }, 'headless.executor'), /not a path or a command/);
  assert.equal(explainConfig({ env: { CONSTRUCT_SOURCE_FRESHNESS_HOURS: '24' } }, 'sources.defaultFreshnessHours').effective.value, 24);
  assert.throws(() => explainConfig({ env: { CONSTRUCT_SOURCE_FRESHNESS_HOURS: '0' } }, 'sources.defaultFreshnessHours'), /positive whole number/);
  assert.equal(explainConfig({ env: { CONSTRUCT_LOCALE: '' } }, 'locale').effective.source, 'built-in default');
  assert.throws(() => explainConfig({}, 'nope'), /unknown configuration key/);
});

test('flags are collected only for known config flags, in both spellings', () => {
  assert.deepEqual(configFlagsFrom(['--locale=fr-FR', '--color', 'never', '--json', '--unknown=1', '--executor']), { '--locale': 'fr-FR', '--color': 'never' });
});

test('user defaults are a closed presentation schema in the per-user config dir', () => {
  const path = userDefaultsPath({ configDir: '/home/u/.config/construct', stateDir: '', dataDir: '', cacheDir: '' });
  assert.equal(path, '/home/u/.config/construct/config.json');
  const ok = validateUserDefaults({ format: 'construct-user-defaults', formatVersion: 1, values: { locale: 'fr-FR' } }, path);
  assert.deepEqual(ok.values, { locale: 'fr-FR' });
  assert.throws(() => validateUserDefaults({ format: 'construct-user-defaults', formatVersion: 1, values: { 'policy.projectWrite': 'never' } }, path), /cannot be set by user defaults/);
  assert.throws(() => validateUserDefaults({ format: 'construct-user-defaults', formatVersion: 1, values: { githubToken: 'x' } }, path), ProjectFileError);
  assert.throws(() => validateUserDefaults({ format: 'construct-user-defaults', formatVersion: 2, values: {} }, path), /does not read/);
  for (const spec of CONFIG_KEYS) assert.ok(spec.settableBy.length > 0, `${spec.key} is settable somewhere`);
});
