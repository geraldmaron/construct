/**
 * tests/cli/settings.test.ts — the file-backed preference ladder: that each
 * layer overrides the one beneath it, that the print command names where every
 * value came from, and that the closed schema keeps a file from carrying a
 * consent setting, an unknown key, a host that is a path, or a value that would
 * reach the screen unescaped.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src/cli/index.ts';
import type { Paths } from '../../src/kernel/paths.ts';
import {
  discoverProjectSettings,
  globalSettingsPath,
  projectTrustNote,
  readSettingsFile,
  resolveSettings,
  SettingsError,
} from '../../src/cli/settings-file.ts';
import type { ResolveInputs } from '../../src/cli/settings-file.ts';

interface Bench {
  readonly paths: Paths;
  readonly root: string;
  readonly home: string;
  readonly projectFile: string;
  writeGlobal(value: unknown): void;
  writeProject(value: unknown): void;
  writeProjectRaw(text: string): void;
  cleanup(): void;
}

function bench(): Bench {
  const root = mkdtempSync(join(tmpdir(), 'construct-settings-'));
  const paths: Paths = {
    configDir: join(root, 'config'),
    stateDir: join(root, 'state'),
    dataDir: join(root, 'data'),
    cacheDir: join(root, 'cache'),
  };
  const projectRoot = join(root, 'project', 'nested', 'deep');
  const projectDir = join(root, 'project', '.construct');
  const projectFile = join(projectDir, 'settings.json');
  const ensureProject = (): void => {
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(projectRoot, { recursive: true });
    // A git root bounds discovery and gives the file a repository to be scoped
    // to, the way a real checkout would.
    mkdirSync(join(root, 'project', '.git'), { recursive: true });
  };
  return {
    paths,
    root: projectRoot,
    home: root,
    projectFile,
    writeGlobal(value) {
      mkdirSync(paths.configDir, { recursive: true });
      writeFileSync(globalSettingsPath(paths), JSON.stringify(value));
    },
    writeProject(value) {
      ensureProject();
      writeFileSync(projectFile, JSON.stringify(value));
    },
    writeProjectRaw(text) {
      ensureProject();
      writeFileSync(projectFile, text);
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function inputs(
  b: Bench,
  over: Partial<Pick<ResolveInputs, 'env' | 'flags' | 'cwd' | 'home' | 'ratified'>> = {},
): ResolveInputs {
  return {
    paths: b.paths,
    cwd: over.cwd ?? b.root,
    env: over.env ?? {},
    flags: over.flags ?? {},
    home: over.home ?? b.home,
    // Nothing is trusted unless a test says so, which is the gate's default.
    ratified: over.ratified ?? (() => false),
  };
}

function bySource(settings: ReturnType<typeof resolveSettings>, key: string): { display: string; source: string } {
  const found = settings.find((s) => s.key === key);
  assert.ok(found, `no resolved setting for ${key}`);
  return { display: found.display, source: found.source };
}

test('with nothing set, every preference reports its built-in default', () => {
  const b = bench();
  try {
    const resolved = resolveSettings(inputs(b));
    assert.deepEqual(bySource(resolved, 'host'), { display: 'opencode', source: 'built-in default' });
    assert.deepEqual(bySource(resolved, 'locale'), { display: 'en-US', source: 'built-in default' });
    assert.deepEqual(bySource(resolved, 'groundHints'), { display: '(none)', source: 'built-in default' });
  } finally {
    b.cleanup();
  }
});

test('the global file overrides the built-in default and is named as the source', () => {
  const b = bench();
  try {
    b.writeGlobal({ host: 'claude', locale: 'pt-BR' });
    const resolved = resolveSettings(inputs(b));
    assert.deepEqual(bySource(resolved, 'host'), { display: 'claude', source: 'global file' });
    assert.deepEqual(bySource(resolved, 'locale'), { display: 'pt-BR', source: 'global file' });
  } finally {
    b.cleanup();
  }
});

test('a project file contributes nothing until it is ratified', () => {
  const b = bench();
  try {
    b.writeGlobal({ host: 'claude' });
    b.writeProject({ host: 'cursor' });

    // Not ratified: the global file still wins, and a note explains why.
    const closed = resolveSettings(inputs(b));
    assert.deepEqual(bySource(closed, 'host'), { display: 'claude', source: 'global file' });
    const note = projectTrustNote(inputs(b));
    assert.ok(note && /not trusted/.test(note) && /construct trust/.test(note));

    // Ratified: the project file overrides the global one.
    const open = resolveSettings(inputs(b, { ratified: () => true }));
    assert.deepEqual(bySource(open, 'host'), { display: 'cursor', source: 'project file' });
    assert.equal(projectTrustNote(inputs(b, { ratified: () => true })), null);
  } finally {
    b.cleanup();
  }
});

test('an environment variable overrides a ratified project file', () => {
  const b = bench();
  try {
    b.writeProject({ host: 'cursor' });
    const resolved = resolveSettings(
      inputs(b, { ratified: () => true, env: { CONSTRUCT_HOST: 'codex' } }),
    );
    assert.deepEqual(bySource(resolved, 'host'), { display: 'codex', source: 'environment' });
  } finally {
    b.cleanup();
  }
});

test('a flag overrides an environment variable', () => {
  const b = bench();
  try {
    const resolved = resolveSettings(
      inputs(b, { env: { CONSTRUCT_HOST: 'codex' }, flags: { host: 'claude' } }),
    );
    assert.deepEqual(bySource(resolved, 'host'), { display: 'claude', source: 'flag' });
  } finally {
    b.cleanup();
  }
});

test('a consent-bearing key in a file is refused, naming where consent lives', () => {
  const b = bench();
  try {
    b.writeGlobal({ consent: 'on' });
    assert.throws(
      () => resolveSettings(inputs(b)),
      (error: unknown) =>
        error instanceof SettingsError &&
        /consent/.test(error.message) &&
        /construct consent/.test(error.message),
    );
  } finally {
    b.cleanup();
  }
});

test('engagement mode in a file is refused, naming where it lives', () => {
  const b = bench();
  try {
    b.writeGlobal({ mode: 'team' });
    assert.throws(
      () => resolveSettings(inputs(b)),
      (error: unknown) =>
        error instanceof SettingsError && /construct mode/.test(error.message),
    );
  } finally {
    b.cleanup();
  }
});

test('an unknown key is refused outright, listing what is allowed', () => {
  const b = bench();
  try {
    b.writeGlobal({ notAKey: 'value' });
    assert.throws(
      () => resolveSettings(inputs(b)),
      (error: unknown) =>
        error instanceof SettingsError && /not a setting Construct reads from a file/.test(error.message),
    );
  } finally {
    b.cleanup();
  }
});

test('a host given as a path is refused as a path, not just as an unknown value', () => {
  const b = bench();
  try {
    b.writeGlobal({ host: './evil.sh' });
    assert.throws(
      () => resolveSettings(inputs(b)),
      (error: unknown) => error instanceof SettingsError && /not a path/.test(error.message),
    );
  } finally {
    b.cleanup();
  }
});

test('a host that is not one of the shipped adapters is refused', () => {
  const b = bench();
  try {
    b.writeGlobal({ host: 'gpt' });
    assert.throws(
      () => resolveSettings(inputs(b)),
      (error: unknown) => error instanceof SettingsError,
    );
  } finally {
    b.cleanup();
  }
});

test('a malformed locale and a non-list of ground hints are both refused', () => {
  const b = bench();
  try {
    b.writeGlobal({ locale: 'not a locale/../x' });
    assert.throws(() => resolveSettings(inputs(b)), SettingsError);

    b.writeGlobal({ groundHints: 'a single string, not a list' });
    assert.throws(() => resolveSettings(inputs(b)), SettingsError);
  } finally {
    b.cleanup();
  }
});

test('a control byte in a ground hint is escaped, never printed raw', () => {
  const b = bench();
  try {
    b.writeGlobal({ groundHints: ['prefer\u001b[31m the ADRs', 'second\nhint'] });
    const resolved = resolveSettings(inputs(b));
    const { display, source } = bySource(resolved, 'groundHints');
    assert.equal(source, 'global file');
    assert.ok(!display.includes('\u001b'), 'the escape byte must not reach the screen');
    assert.ok(!display.includes('\n'), 'a newline in a hint must not forge a line');
    assert.ok(display.includes('\\x1b'), 'the escape byte is shown in its visible form');
    assert.ok(display.includes('\\n'), 'the newline is shown in its visible form');
  } finally {
    b.cleanup();
  }
});

test('ground hints from a scalar split on commas', () => {
  const b = bench();
  try {
    const resolved = resolveSettings(
      inputs(b, { env: { CONSTRUCT_GROUND_HINTS: 'prefer the ADRs, ignore drafts' } }),
    );
    assert.deepEqual(bySource(resolved, 'groundHints'), {
      display: 'prefer the ADRs, ignore drafts',
      source: 'environment',
    });
  } finally {
    b.cleanup();
  }
});

test('a project file is discovered by walking up the tree, bounded by the git root', () => {
  const b = bench();
  try {
    b.writeProject({ host: 'cursor' });
    const found = discoverProjectSettings(b.root, b.home);
    assert.equal(found.outcome, 'found');
    assert.ok(found.outcome === 'found' && found.path.endsWith(join('.construct', 'settings.json')));
    // A directory under no repository and outside home discovers nothing: the
    // walk has no floor, so it never climbs to a stray /tmp/.construct.
    assert.equal(discoverProjectSettings(tmpdir(), null).outcome, 'absent');
  } finally {
    b.cleanup();
  }
});

test('a file that is not there contributes nothing', () => {
  const b = bench();
  try {
    assert.equal(readSettingsFile(globalSettingsPath(b.paths)), null);
  } finally {
    b.cleanup();
  }
});

test('construct settings prints every value with the layer it came from', async () => {
  const xdgHome = mkdtempSync(join(tmpdir(), 'construct-settings-cli-'));
  // settings now opens the store to learn whether a project file is trusted, so
  // every XDG root is redirected into the tmpdir — the sterile discipline the
  // rest of the suite keeps, so this never writes into a real ~/.
  const saved: Record<string, string | undefined> = {};
  for (const key of ['XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'CONSTRUCT_HOST']) {
    saved[key] = process.env[key];
  }
  process.env.XDG_CONFIG_HOME = join(xdgHome, 'config');
  process.env.XDG_STATE_HOME = join(xdgHome, 'state');
  process.env.XDG_DATA_HOME = join(xdgHome, 'data');
  process.env.XDG_CACHE_HOME = join(xdgHome, 'cache');
  delete process.env.CONSTRUCT_HOST;
  mkdirSync(join(xdgHome, 'config', 'construct'), { recursive: true });
  writeFileSync(
    join(xdgHome, 'config', 'construct', 'settings.json'),
    JSON.stringify({ host: 'claude' }),
  );
  const out: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  (process.stdout as { write: unknown }).write = (c: string) => (out.push(String(c)), true);
  let code: number;
  try {
    code = await main(['settings']);
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(xdgHome, { recursive: true, force: true });
  }
  const text = out.join('');
  assert.equal(code, 0);
  assert.match(text, /host\s+claude\s+\(global file\)/);
  assert.match(text, /locale\s+en-US\s+\(built-in default\)/);
  assert.match(text, /groundHints\s+\(none\)\s+\(built-in default\)/);
});

test('a malformed project file is a real error even when it would not be admitted', () => {
  const b = bench();
  try {
    // Not admitted (no opt-in), but the file is still read and held to schema.
    b.writeProjectRaw('{ not json');
    assert.throws(() => resolveSettings(inputs(b)), SettingsError);
  } finally {
    b.cleanup();
  }
});
