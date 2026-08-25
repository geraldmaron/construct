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
  findProjectSettingsPath,
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
  };
  return {
    paths,
    root: projectRoot,
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
  over: Partial<Pick<ResolveInputs, 'env' | 'flags' | 'cwd'>> = {},
): ResolveInputs {
  return {
    paths: b.paths,
    cwd: over.cwd ?? b.root,
    env: over.env ?? {},
    flags: over.flags ?? {},
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

test('a project file contributes nothing until the trust seam opts it in', () => {
  const b = bench();
  try {
    b.writeGlobal({ host: 'claude' });
    b.writeProject({ host: 'cursor' });

    // Not admitted: the global file still wins, and a note explains why.
    const closed = resolveSettings(inputs(b));
    assert.deepEqual(bySource(closed, 'host'), { display: 'claude', source: 'global file' });
    const note = projectTrustNote(inputs(b));
    assert.ok(note && note.includes('CONSTRUCT_TRUST_PROJECT_SETTINGS'));

    // Opted in: the project file overrides the global one.
    const open = resolveSettings(inputs(b, { env: { CONSTRUCT_TRUST_PROJECT_SETTINGS: 'on' } }));
    assert.deepEqual(bySource(open, 'host'), { display: 'cursor', source: 'project file' });
    assert.equal(projectTrustNote(inputs(b, { env: { CONSTRUCT_TRUST_PROJECT_SETTINGS: 'on' } })), null);
  } finally {
    b.cleanup();
  }
});

test('an environment variable overrides an admitted project file', () => {
  const b = bench();
  try {
    b.writeProject({ host: 'cursor' });
    const env = { CONSTRUCT_TRUST_PROJECT_SETTINGS: 'on', CONSTRUCT_HOST: 'codex' };
    const resolved = resolveSettings(inputs(b, { env }));
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

test('a project file is discovered by walking up the tree', () => {
  const b = bench();
  try {
    b.writeProject({ host: 'cursor' });
    const found = findProjectSettingsPath(b.root);
    assert.ok(found && found.endsWith(join('.construct', 'settings.json')));
    assert.equal(findProjectSettingsPath(tmpdir()), null);
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
  const configHome = mkdtempSync(join(tmpdir(), 'construct-settings-cli-'));
  const previous = process.env.XDG_CONFIG_HOME;
  const previousHost = process.env.CONSTRUCT_HOST;
  process.env.XDG_CONFIG_HOME = configHome;
  delete process.env.CONSTRUCT_HOST;
  mkdirSync(join(configHome, 'construct'), { recursive: true });
  writeFileSync(join(configHome, 'construct', 'settings.json'), JSON.stringify({ host: 'claude' }));
  const out: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  (process.stdout as { write: unknown }).write = (c: string) => (out.push(String(c)), true);
  let code: number;
  try {
    code = await main(['settings']);
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    if (previousHost !== undefined) process.env.CONSTRUCT_HOST = previousHost;
    rmSync(configHome, { recursive: true, force: true });
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
