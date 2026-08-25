/**
 * tests/cli/state-setting.test.ts — the `state` preference key in the closed
 * schema: it resolves through the same ratification gate every other project
 * value does, and it is worthless on its own — see tests/cli/local-state.test.ts
 * for the refusal that guards what it actually does once ratified.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Paths } from '../../src/kernel/paths.ts';
import { resolveSettings, SettingsError } from '../../src/cli/settings-file.ts';
import type { ResolveInputs } from '../../src/cli/settings-file.ts';

interface Bench {
  readonly paths: Paths;
  readonly cwd: string;
  readonly home: string;
  writeProject(value: unknown): void;
  cleanup(): void;
}

function bench(): Bench {
  const root = mkdtempSync(join(tmpdir(), 'construct-state-setting-'));
  const paths: Paths = {
    configDir: join(root, 'config'),
    stateDir: join(root, 'state'),
    dataDir: join(root, 'data'),
    cacheDir: join(root, 'cache'),
  };
  const cwd = join(root, 'project');
  const conDir = join(cwd, '.construct');
  return {
    paths,
    cwd,
    home: root,
    writeProject(value) {
      mkdirSync(conDir, { recursive: true });
      mkdirSync(join(cwd, '.git'), { recursive: true });
      writeFileSync(join(conDir, 'settings.json'), JSON.stringify(value));
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function inputs(b: Bench, over: Partial<ResolveInputs> = {}): ResolveInputs {
  return {
    paths: b.paths,
    cwd: b.cwd,
    env: {},
    flags: {},
    home: b.home,
    ratified: () => false,
    ...over,
  };
}

function stateOf(resolved: ReturnType<typeof resolveSettings>): { display: string; source: string } {
  const found = resolved.find((s) => s.key === 'state');
  assert.ok(found, 'no resolved setting for state');
  return { display: found.display, source: found.source };
}

test('with nothing set, state resolves to home', () => {
  const b = bench();
  try {
    assert.deepEqual(stateOf(resolveSettings(inputs(b))), {
      display: 'home',
      source: 'built-in default',
    });
  } finally {
    b.cleanup();
  }
});

test('an unratified project file declaring state: local has zero effect', () => {
  const b = bench();
  try {
    b.writeProject({ state: 'local' });
    assert.deepEqual(stateOf(resolveSettings(inputs(b, { ratified: () => false }))), {
      display: 'home',
      source: 'built-in default',
    });
  } finally {
    b.cleanup();
  }
});

test('a ratified project file declaring state: local resolves through the ladder', () => {
  const b = bench();
  try {
    b.writeProject({ state: 'local' });
    assert.deepEqual(stateOf(resolveSettings(inputs(b, { ratified: () => true }))), {
      display: 'local',
      source: 'project file',
    });
  } finally {
    b.cleanup();
  }
});

test('CONSTRUCT_STATE overrides a ratified project file, like every other preference', () => {
  const b = bench();
  try {
    b.writeProject({ state: 'local' });
    const resolved = resolveSettings(
      inputs(b, { ratified: () => true, env: { CONSTRUCT_STATE: 'home' } }),
    );
    assert.deepEqual(stateOf(resolved), { display: 'home', source: 'environment' });
  } finally {
    b.cleanup();
  }
});

test('an invalid state value is refused at parse', () => {
  const b = bench();
  try {
    b.writeProject({ state: 'elsewhere' });
    assert.throws(
      () => resolveSettings(inputs(b, { ratified: () => true })),
      (error: unknown) => error instanceof SettingsError && /state must be "local" or "home"/.test(error.message),
    );
  } finally {
    b.cleanup();
  }
});

test('a non-string state value is refused, naming the type it got', () => {
  const b = bench();
  try {
    b.writeProject({ state: 7 });
    assert.throws(
      () => resolveSettings(inputs(b, { ratified: () => true })),
      (error: unknown) => error instanceof SettingsError && /state must be "local" or "home", not number/.test(error.message),
    );
  } finally {
    b.cleanup();
  }
});
