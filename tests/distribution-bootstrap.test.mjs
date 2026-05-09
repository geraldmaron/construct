/**
 * tests/distribution-bootstrap.test.mjs — peer-clone distribution invariants.
 *
 * Verifies:
 *   - postinstall stages `.construct/{version,bootstrap.sh,bootstrap.ps1,run.mjs}`
 *     and `.construct/cache/bin/` in the consumer project.
 *   - The version file is the package's published version.
 *   - bootstrap.sh has executable bits.
 *   - run.mjs respects CONSTRUCT_DEV_PATH and forwards to the local checkout.
 *   - run.mjs exits 127 with a useful error when no runtime is reachable.
 *   - The materialised `.claude/settings.json` references hook commands as
 *     `node .construct/run.mjs hook <name>` (no `$HOME/.construct` paths).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it, before, after } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const POSTINSTALL = path.join(ROOT, 'bin', 'construct-postinstall.mjs');
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

let projectDir;

before(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-dist-bootstrap-'));
  fs.writeFileSync(
    path.join(projectDir, 'package.json'),
    JSON.stringify({ name: 'fixture-consumer', version: '0.0.0' })
  );
  const result = spawnSync(process.execPath, [POSTINSTALL], {
    encoding: 'utf8',
    cwd: projectDir,
    env: {
      ...process.env,
      INIT_CWD: projectDir,
      CONSTRUCT_SKIP_POSTINSTALL: '',
    },
    timeout: 60_000,
  });
  if (result.status !== 0) {
    throw new Error(`postinstall failed:\n${result.stdout}\n${result.stderr}`);
  }
});

after(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe('project-local launcher staging', () => {
  it('stages every launcher file into .construct/', () => {
    for (const name of ['version', 'run.mjs', 'bootstrap.sh', 'bootstrap.ps1']) {
      const p = path.join(projectDir, '.construct', name);
      assert.ok(fs.existsSync(p), `missing .construct/${name}`);
    }
  });

  it('writes the package version into .construct/version', () => {
    const v = fs.readFileSync(path.join(projectDir, '.construct', 'version'), 'utf8').trim();
    assert.equal(v, PKG_VERSION);
  });

  it('marks bootstrap.sh executable', () => {
    const stat = fs.statSync(path.join(projectDir, '.construct', 'bootstrap.sh'));
    assert.ok((stat.mode & 0o100) !== 0, 'bootstrap.sh must be user-executable');
  });

  it('creates the cache/bin scratch dir', () => {
    const p = path.join(projectDir, '.construct', 'cache', 'bin');
    assert.ok(fs.existsSync(p) && fs.statSync(p).isDirectory());
  });
});

describe('settings.json hook command shape', () => {
  it('hook commands target node .construct/run.mjs hook <name>', () => {
    const settingsPath = path.join(projectDir, '.claude', 'settings.json');
    assert.ok(fs.existsSync(settingsPath));
    const text = fs.readFileSync(settingsPath, 'utf8');
    assert.ok(!/\$HOME\/\.construct/.test(text), 'must not reference $HOME paths');
    assert.match(text, /node \.construct\/run\.mjs hook session-start/);
    assert.match(text, /node \.construct\/run\.mjs hook pre-push-gate/);
  });
});

describe('run.mjs resolution', () => {
  it('honours CONSTRUCT_DEV_PATH and invokes the local checkout', () => {
    const result = spawnSync(
      process.execPath,
      [path.join(projectDir, '.construct', 'run.mjs'), 'version'],
      {
        encoding: 'utf8',
        cwd: projectDir,
        env: { ...process.env, CONSTRUCT_DEV_PATH: ROOT },
        timeout: 30_000,
      }
    );
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.stderr}`);
    assert.match(result.stdout, /construct/i);
  });

  it('exits 127 with a precise error when no runtime resolves', () => {
    // Strip everything that could resolve construct from PATH and unset DEV path.
    const result = spawnSync(
      process.execPath,
      [path.join(projectDir, '.construct', 'run.mjs'), 'doctor'],
      {
        encoding: 'utf8',
        cwd: projectDir,
        env: {
          PATH: '/nonexistent',
          HOME: process.env.HOME,
          CONSTRUCT_DEV_PATH: '',
        },
        timeout: 30_000,
      }
    );
    assert.equal(result.status, 127, `expected 127, got ${result.status}`);
    assert.match(result.stderr, /No Construct install found/);
    assert.match(result.stderr, /nodejs\.org/);
  });
});
