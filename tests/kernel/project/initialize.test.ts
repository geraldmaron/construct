/**
 * tests/kernel/project/initialize.test.ts — init creates the exact layout and
 * one database, keeps what validates, and refuses old files unread.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initializeProject, LegacyProjectError, readProjectFiles } from '../../../src/kernel/project/initialize.ts';
import { projectLayout, STATE_GITIGNORE_PATTERN } from '../../../src/kernel/project/layout.ts';
import { ProjectFileError, UnsupportedProjectFileError } from '../../../src/kernel/project/files.ts';
import { getProfile } from '../../../src/kernel/state/profile.ts';
import { STATE_FORMAT_VERSION } from '../../../src/kernel/state/format.ts';
import { tmpProject, AT } from './support.ts';

const input = (root: string) => ({ root, projectId: 'proj-1', name: 'demo', at: AT });

test('a fresh init writes exactly the committed files, one database, and the ignore rule', () => {
  const { root, cleanup } = tmpProject();
  try {
    const result = initializeProject(input(root));
    try {
      const layout = projectLayout(root);
      assert.deepEqual(readdirSync(layout.dir).sort(), ['constitution.json', 'project.json', 'registry.lock.json', 'sources.json', 'state']);
      assert.deepEqual(readdirSync(layout.stateDir), ['construct.sqlite']);
      assert.deepEqual(result.created, { projectFile: true, constitution: true, sources: true, lock: true, state: true });
      assert.equal(result.gitignoreUpdated, true);
      assert.match(readFileSync(join(root, '.gitignore'), 'utf8'), new RegExp(STATE_GITIGNORE_PATTERN.replaceAll('/', '\\/')));
      const config = JSON.parse(readFileSync(layout.projectFile, 'utf8'));
      assert.equal(config.format, 'construct-project');
      assert.equal(config.formatVersion, 2);
      assert.equal(config.id, 'proj-1');
      assert.deepEqual(config.behavior, {});
      assert.equal(result.constitution.name, 'demo');
      assert.equal(result.constitution.formatVersion, 2);
      const meta = result.store.db.prepare(`SELECT value FROM meta WHERE key = 'format_version'`).get() as { value: string };
      assert.equal(meta.value, String(STATE_FORMAT_VERSION));
      const profile = getProfile(result.store);
      assert.equal(profile?.name, 'demo');
      assert.equal(profile?.onboardingState, 'incomplete');
      assert.equal(existsSync(join(layout.dir, 'settings.json')), false);
    } finally {
      result.store.close();
    }
  } finally {
    cleanup();
  }
});

test('a second init keeps every existing file and reopens the same database', () => {
  const { root, cleanup } = tmpProject();
  try {
    const first = initializeProject(input(root));
    first.store.close();
    const second = initializeProject({ ...input(root), projectId: 'different', name: 'other' });
    try {
      assert.deepEqual(second.created, { projectFile: false, constitution: false, sources: false, lock: false, state: false });
      assert.equal(second.config.id, 'proj-1');
      assert.equal(second.gitignoreUpdated, false);
      assert.deepEqual(readdirSync(second.layout.stateDir), ['construct.sqlite']);
    } finally {
      second.store.close();
    }
  } finally {
    cleanup();
  }
});

test('an earlier alpha settings file stops init, is named exactly, and is never parsed', () => {
  const { root, cleanup } = tmpProject();
  try {
    mkdirSync(join(root, '.construct'), { recursive: true });
    writeFileSync(join(root, '.construct', 'settings.json'), 'this is not even json {{{', 'utf8');
    assert.throws(
      () => initializeProject(input(root)),
      (err: unknown) =>
        err instanceof LegacyProjectError &&
        err.targets.length === 1 &&
        err.targets[0]!.path === join(root, '.construct', 'settings.json') &&
        /construct reset/.test(err.message),
    );
    assert.equal(existsSync(join(root, '.construct', 'project.json')), false);
    assert.equal(existsSync(join(root, '.construct', 'state')), false);
  } finally {
    cleanup();
  }
});

test('a format-1 project.json is recognized by its stamp and refused without migration', () => {
  const { root, cleanup } = tmpProject();
  try {
    mkdirSync(join(root, '.construct'), { recursive: true });
    writeFileSync(join(root, '.construct', 'project.json'), JSON.stringify({ format: 'construct-project', formatVersion: 1, integrations: {} }), 'utf8');
    assert.throws(() => initializeProject(input(root)), (err: unknown) => err instanceof LegacyProjectError && /format construct-project 1/.test(err.targets[0]!.what));
    const after = JSON.parse(readFileSync(join(root, '.construct', 'project.json'), 'utf8'));
    assert.equal(after.formatVersion, 1);
  } finally {
    cleanup();
  }
});

test('a constitution in a foreign format is refused as unsupported, not repaired', () => {
  const { root, cleanup } = tmpProject();
  try {
    const first = initializeProject(input(root));
    first.store.close();
    writeFileSync(join(root, '.construct', 'constitution.json'), JSON.stringify({ format: 'construct-constitution', formatVersion: 9, name: 'x' }), 'utf8');
    assert.throws(() => initializeProject(input(root)), (err: unknown) => err instanceof UnsupportedProjectFileError && err.foundVersion === 9);
  } finally {
    cleanup();
  }
});

test('a symlinked project file is refused', () => {
  const { root, cleanup } = tmpProject();
  try {
    mkdirSync(join(root, '.construct'), { recursive: true });
    writeFileSync(join(root, 'elsewhere.json'), JSON.stringify({ format: 'construct-project', formatVersion: 2, id: 'x', name: 'x', createdAt: AT }), 'utf8');
    symlinkSync(join(root, 'elsewhere.json'), join(root, '.construct', 'project.json'));
    assert.throws(() => initializeProject(input(root)), (err: unknown) => err instanceof ProjectFileError && /symbolic link/.test(err.message));
  } finally {
    cleanup();
  }
});

test('a committed file that tries to grant consent, carry a secret, or name a command is refused', () => {
  const { root, cleanup } = tmpProject();
  try {
    mkdirSync(join(root, '.construct'), { recursive: true });
    const base = { format: 'construct-project', formatVersion: 2, id: 'x', name: 'x', createdAt: AT };
    for (const behavior of [{ consentGranted: true }, { apiToken: 'abc' }, { headlessCommand: '/bin/sh' }, { externalWrite: true }]) {
      writeFileSync(join(root, '.construct', 'project.json'), JSON.stringify({ ...base, behavior }), 'utf8');
      assert.throws(() => initializeProject(input(root)), (err: unknown) => err instanceof ProjectFileError && /cannot grant consent, carry secrets/.test(err.message));
    }
    writeFileSync(join(root, '.construct', 'project.json'), JSON.stringify({ ...base, behavior: { colour: 'always' } }), 'utf8');
    assert.throws(() => initializeProject(input(root)), /unknown key "colour"/);
    writeFileSync(join(root, '.construct', 'project.json'), JSON.stringify({ ...base, behavior: { color: 'always' } }), 'utf8');
    assert.throws(() => initializeProject(input(root)), /cannot be set by project config/);
    writeFileSync(join(root, '.construct', 'project.json'), JSON.stringify({ ...base, behavior: { 'headless.executor': '/usr/bin/evil' } }), 'utf8');
    assert.throws(() => initializeProject(input(root)), /not a path or a command/);
  } finally {
    cleanup();
  }
});

test('readProjectFiles reads the committed set without touching state', () => {
  const { root, cleanup } = tmpProject();
  try {
    assert.deepEqual(readProjectFiles(root), { config: null, constitution: null, sources: null, lock: null });
    const init = initializeProject(input(root));
    init.store.close();
    const files = readProjectFiles(root);
    assert.equal(files.config?.id, 'proj-1');
    assert.equal(files.sources?.sources.length, 0);
    assert.deepEqual(files.lock?.skills, {});
  } finally {
    cleanup();
  }
});
