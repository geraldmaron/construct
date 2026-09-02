/**
 * tests/kernel/project/discover-reset-files.test.ts — discovery never crosses a
 * repository boundary; reset removes only what was named; the committed source
 * and lock files carry no credentials.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findProjectRoot, requireProjectRoot, NoProjectError } from '../../../src/kernel/project/discover.ts';
import { initializeProject } from '../../../src/kernel/project/initialize.ts';
import { planReset, applyReset, ResetNotConfirmedError } from '../../../src/kernel/project/reset.ts';
import { validateSourcesFile } from '../../../src/kernel/project/sources-file.ts';
import { validateLock } from '../../../src/kernel/project/lock.ts';
import { detectLegacyHomeState } from '../../../src/kernel/project/legacy.ts';
import { tmpProject, AT } from './support.ts';

test('discovery walks up to the floor and never past it', () => {
  const { root, cleanup } = tmpProject();
  try {
    const outer = join(root, 'outer');
    const inner = join(outer, 'packages', 'inner');
    mkdirSync(join(inner, 'src', 'deep'), { recursive: true });
    initializeProject({ root: outer, projectId: 'outer', name: 'outer', at: AT }).store.close();

    // Inside the outer repository: found from deep below.
    assert.equal(findProjectRoot({ start: join(inner, 'src', 'deep'), floor: outer }), outer);
    // A nested repository is its own floor: the outer project is not reached.
    assert.equal(findProjectRoot({ start: join(inner, 'src', 'deep'), floor: inner }), null);
    // No floor means no walking at all.
    assert.equal(findProjectRoot({ start: join(inner, 'src') }), null);
    assert.equal(findProjectRoot({ start: outer }), outer);
    // A floor that is not an ancestor only checks the start.
    assert.equal(findProjectRoot({ start: inner, floor: join(root, 'unrelated') }), null);
    assert.throws(() => requireProjectRoot({ start: inner, floor: inner }), NoProjectError);
  } finally {
    cleanup();
  }
});

test('reset names exact targets and removes only what was confirmed', () => {
  const { root, cleanup } = tmpProject();
  try {
    initializeProject({ root, projectId: 'p', name: 'p', at: AT }).store.close();
    mkdirSync(join(root, '.construct'), { recursive: true });
    writeFileSync(join(root, '.construct', 'settings.json'), '{}', 'utf8');
    const plan = planReset(root);
    assert.deepEqual(plan.targets.map((t) => t.path).sort(), [join(root, '.construct', 'settings.json'), join(root, '.construct', 'state', 'construct.sqlite')].sort());
    assert.throws(() => applyReset(plan, []), ResetNotConfirmedError);
    assert.throws(() => applyReset(plan, [join(root, '.construct', 'project.json')]), /did not name/);
    const removed = applyReset(plan, [join(root, '.construct', 'settings.json')]);
    assert.deepEqual(removed, [join(root, '.construct', 'settings.json')]);
    assert.equal(existsSync(join(root, '.construct', 'state', 'construct.sqlite')), true);
    assert.equal(existsSync(join(root, '.construct', 'project.json')), true);

    const full = planReset(root, { includeProjectFiles: true });
    assert.equal(full.targets.length, 5);
    applyReset(full, full.targets.map((t) => t.path));
    assert.equal(existsSync(join(root, '.construct', 'project.json')), false);
    assert.equal(existsSync(join(root, '.gitignore')), true);
  } finally {
    cleanup();
  }
});

test('an old per-user database is named for removal and never opened', () => {
  const { root, cleanup } = tmpProject();
  try {
    const paths = { configDir: join(root, 'c'), stateDir: join(root, 's'), dataDir: join(root, 'd'), cacheDir: join(root, 'k') };
    assert.deepEqual(detectLegacyHomeState(paths), []);
    mkdirSync(paths.dataDir, { recursive: true });
    writeFileSync(join(paths.dataDir, 'construct.db'), 'not sqlite at all', 'utf8');
    const found = detectLegacyHomeState(paths);
    assert.equal(found.length, 1);
    assert.match(found[0]!.what, /earlier alpha/);
    assert.equal(planReset(root, { paths }).targets.some((t) => t.path === join(paths.dataDir, 'construct.db')), true);
  } finally {
    cleanup();
  }
});

test('source declarations refuse credentials in any form', () => {
  const path = '/repo/.construct/sources.json';
  const good = validateSourcesFile({
    format: 'construct-sources', formatVersion: 2,
    sources: [{ id: 'jira', kind: 'jira', purpose: 'work tracking', locator: 'https://example.atlassian.net', authorityLevel: 'authoritative', authoritativeFor: ['work_item'], notAuthoritativeFor: ['capacity'], sensitivity: 'internal', capabilities: { read: true, write: true } }],
  }, path);
  assert.equal(good.sources[0]?.write, true);
  assert.deepEqual(good.sources[0]?.notAuthoritativeFor, ['capacity']);
  const base = { format: 'construct-sources', formatVersion: 2 };
  const src = (extra: Record<string, unknown>) => ({ id: 'jira', kind: 'jira', purpose: 'x', authorityLevel: 'informative', sensitivity: 'internal', ...extra });
  assert.throws(() => validateSourcesFile({ ...base, sources: [src({ locator: 'https://user:pass@example.com' })] }, path), /carries credentials/);
  assert.throws(() => validateSourcesFile({ ...base, sources: [src({ token: 'abc' })] }, path), /cannot grant consent, carry secrets/);
  assert.throws(() => validateSourcesFile({ ...base, sources: [src({ auth: { password: 'x' } })] }, path), /cannot grant consent, carry secrets/);
  assert.throws(() => validateSourcesFile({ ...base, sources: [src({}), src({})] }, path), /appears twice/);
  assert.throws(() => validateSourcesFile({ ...base, sources: [src({ authoritativeFor: ['a'], notAuthoritativeFor: ['a'] })] }, path), /both authoritative and not/);
  assert.throws(() => validateSourcesFile({ ...base, sources: [src({ id: 'Bad Id' })] }, path), /lowercase letters/);
  assert.throws(() => validateSourcesFile({ ...base, sources: [src({ sensitivity: 'secretish' })] }, path), /sensitivity/);
});

test('the lockfile carries semantic versions and sha256 digests only', () => {
  const path = '/repo/.construct/registry.lock.json';
  const digest = `sha256:${'a'.repeat(64)}`;
  const ok = validateLock({ format: 'construct-registry-lock', formatVersion: 2, skills: { intake: { version: '1.2.3', digest, origin: 'builtin' } } }, path);
  assert.equal(ok.skills.intake?.version, '1.2.3');
  assert.throws(() => validateLock({ format: 'construct-registry-lock', formatVersion: 2, skills: { intake: { version: 'latest', digest, origin: 'builtin' } } }, path), /semantic version/);
  assert.throws(() => validateLock({ format: 'construct-registry-lock', formatVersion: 2, skills: { intake: { version: '1.0.0', digest: 'md5:abc', origin: 'builtin' } } }, path), /sha256/);
  assert.throws(() => validateLock({ format: 'construct-registry-lock', formatVersion: 2, workflows: { w: { version: '1.0.0', digest, origin: 'remote' } } }, path), /builtin or project/);
});
