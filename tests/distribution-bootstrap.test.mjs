/**
 * tests/distribution-bootstrap.test.mjs — peer-clone distribution invariants.
 *
 * Verifies:
 *   - postinstall stages `.construct/launcher/{version,bootstrap.sh,bootstrap.ps1,run.mjs}`
 *     and `.construct/launcher/cache/bin/` in the consumer project.
 *   - The version file is the package's published version.
 *   - bootstrap.sh has executable bits.
 *   - run.mjs respects CONSTRUCT_DEV_PATH and forwards to the local checkout.
 *   - run.mjs exits 127 with a useful error when no runtime is reachable.
 *   - The materialised `.claude/settings.json` references hook commands as
 *     `node "${CLAUDE_PROJECT_DIR:-<absRoot>}/.construct/launcher/run.mjs" hook <name>` — the
 *     fallback is the absolute project root (not cwd-relative `.`) so hooks resolve
 *     from any directory and under hosts that do not export CLAUDE_PROJECT_DIR
 *     (no `$HOME/.construct` paths).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { rmTmpDir } from './helpers/cleanup.mjs';
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
let projectHome;

function writableTmpRoot() {
  const candidates = [
    process.env.CONSTRUCT_TEST_TMPDIR,
    path.join(ROOT, '.tmp', 'tests'),
    '/private/tmp',
    os.tmpdir(),
    '/tmp',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      fs.accessSync(candidate, fs.constants.W_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error('No writable temp root available for distribution bootstrap tests');
}

before(() => {
  projectDir = fs.mkdtempSync(path.join(writableTmpRoot(), 'cx-dist-bootstrap-'));
  projectHome = fs.mkdtempSync(path.join(writableTmpRoot(), 'cx-dist-bootstrap-home-'));
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
      HOME: projectHome,
      CX_HOME_OVERRIDE: projectHome,
    },
    timeout: 60_000,
  });
  if (result.status !== 0) {
    throw new Error(`postinstall failed:\n${result.stdout}\n${result.stderr}`);
  }
});

after(() => {
  rmTmpDir(projectDir);
  rmTmpDir(projectHome);
});

describe('project-local launcher staging', () => {
  it('stages every launcher file into .construct/launcher/', () => {
    for (const name of ['version', 'run.mjs', 'bootstrap.sh', 'bootstrap.ps1']) {
      const p = path.join(projectDir, '.construct', 'launcher', name);
      assert.ok(fs.existsSync(p), `missing .construct/launcher/${name}`);
    }
  });

  it('writes the package version into .construct/version', () => {
    const v = fs.readFileSync(path.join(projectDir, '.construct', 'launcher', 'version'), 'utf8').trim();
    assert.equal(v, PKG_VERSION);
  });

  it('marks bootstrap.sh executable', () => {
    const stat = fs.statSync(path.join(projectDir, '.construct', 'launcher', 'bootstrap.sh'));
    assert.ok((stat.mode & 0o100) !== 0, 'bootstrap.sh must be user-executable');
  });

  it('creates the cache/bin scratch dir', () => {
    const p = path.join(projectDir, '.construct', 'launcher', 'cache', 'bin');
    assert.ok(fs.existsSync(p) && fs.statSync(p).isDirectory());
  });
});

describe('settings.json hook command shape', () => {
  it('hook commands anchor on ${CLAUDE_PROJECT_DIR:-<absRoot>}/.construct/launcher/run.mjs', () => {
    const settingsPath = path.join(projectDir, '.claude', 'settings.json');
    assert.ok(fs.existsSync(settingsPath));
    const text = fs.readFileSync(settingsPath, 'utf8');
    assert.ok(!/\$HOME\/\.construct/.test(text), 'must not reference $HOME paths');
    assert.match(text, /\$\{CLAUDE_PROJECT_DIR:-\/[^}]+\}\/\.construct\/launcher\/run\.mjs.{0,4}hook session-start/);
    assert.match(text, /\$\{CLAUDE_PROJECT_DIR:-\/[^}]+\}\/\.construct\/launcher\/run\.mjs.{0,4}hook pre-push-gate/);
    assert.ok(
      !/\$\{CLAUDE_PROJECT_DIR:-\.\}/.test(text),
      'cwd-relative :-. fallback breaks under cwd drift; fallback must be the absolute project root',
    );
    assert.ok(
      !/node \.construct\/launcher\/run\.mjs hook/.test(text),
      'bare relative .construct/launcher/run.mjs breaks when the hook cwd is not the project root',
    );
  });
});

describe('run.mjs resolution', () => {
  it('honours CONSTRUCT_DEV_PATH and invokes the local checkout', () => {
    const result = spawnSync(
      process.execPath,
      [path.join(projectDir, '.construct', 'launcher', 'run.mjs'), 'version'],
      {
        encoding: 'utf8',
        cwd: projectDir,
        env: { ...process.env, CONSTRUCT_DEV_PATH: ROOT, HOME: projectHome, CX_HOME_OVERRIDE: projectHome },
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
      [path.join(projectDir, '.construct', 'launcher', 'run.mjs'), 'doctor'],
      {
        encoding: 'utf8',
        cwd: projectDir,
        env: {
          PATH: '/nonexistent',
          HOME: projectHome,
          CX_HOME_OVERRIDE: projectHome,
          CONSTRUCT_DEV_PATH: '',
          CONSTRUCT_DISABLE_DOCKER: '1',
        },
        timeout: 30_000,
      }
    );
    assert.equal(result.status, 127, `expected 127, got ${result.status}`);
    assert.match(result.stderr, /No Construct install found/);
    assert.match(result.stderr, /nodejs\.org/);
  });

  it('failure message names docker + the bootstrap shims as install options', () => {
    const result = spawnSync(
      process.execPath,
      [path.join(projectDir, '.construct', 'launcher', 'run.mjs'), 'doctor'],
      {
        encoding: 'utf8',
        cwd: projectDir,
        env: {
          PATH: '/nonexistent',
          HOME: projectHome,
          CX_HOME_OVERRIDE: projectHome,
          CONSTRUCT_DEV_PATH: '',
          CONSTRUCT_DISABLE_DOCKER: '1',
        },
        timeout: 30_000,
      }
    );
    assert.match(result.stderr, /docker pull/);
    assert.match(result.stderr, /bootstrap\.sh/);
    assert.match(result.stderr, /bootstrap\.ps1/);
  });

  it('lists docker between cached binary and the failure path in the resolver source', () => {
    const text = fs.readFileSync(path.join(projectDir, '.construct', 'launcher', 'run.mjs'), 'utf8');
    const cached = text.indexOf('tryCachedBinary()');
    const docker = text.indexOf('tryDocker(');
    const fail = text.indexOf('else fail();');
    assert.ok(cached > 0 && docker > 0 && fail > 0, 'all three branches present');
    // In the bottom-of-file resolver, docker must appear after cachedBinary
    // and before fail so the resolution chain is npx → global → cached → docker → fail.
    const finalCached = text.lastIndexOf('tryCachedBinary()');
    const finalDocker = text.lastIndexOf('tryDocker(');
    const finalFail = text.lastIndexOf('else fail();');
    assert.ok(finalCached < finalDocker, 'docker fallback must come after cached binary');
    assert.ok(finalDocker < finalFail, 'docker fallback must come before the fail() branch');
  });
});

// The staged launcher is a copy of templates/distribution/run.mjs. A hand-edited
// or stale staged copy silently diverges from the template, and template fixes
// never reach it — exactly the drift that left this repo's own hooks dead-ending
// at npx. Byte-equality is the guard that keeps the two from proliferating apart.

describe('launcher drift guard', () => {
  it('this repo\'s staged .construct/run.mjs is byte-identical to the template', () => {
    const staged = path.join(ROOT, '.construct', 'run.mjs');
    const template = path.join(ROOT, 'templates', 'distribution', 'run.mjs');
    assert.ok(fs.existsSync(staged), 'repo .construct/run.mjs must exist');
    assert.equal(
      fs.readFileSync(staged, 'utf8'),
      fs.readFileSync(template, 'utf8'),
      'staged launcher has drifted from the template — re-stage via stage-project'
    );
  });
});

describe('run.mjs self-repo resolution', () => {
  it('invokes ./bin/construct when staged inside the @geraldmaron/construct checkout', () => {
    // No CONSTRUCT_DEV_PATH, no global construct on PATH, no node_modules — the
    // only resolver that may fire is trySelfRepo, keyed on the project's own
    // package.json name. This is the construct repo's own session every day.
    const cleanPath = [path.dirname(process.execPath), '/usr/bin', '/bin']
      .filter((p) => fs.existsSync(p))
      .join(':');
    const result = spawnSync(
      process.execPath,
      [path.join(ROOT, '.construct', 'run.mjs'), 'version'],
      {
        encoding: 'utf8',
        cwd: ROOT,
        env: {
          PATH: cleanPath,
          HOME: projectHome,
          CX_HOME_OVERRIDE: projectHome,
          CONSTRUCT_DEV_PATH: '',
          CONSTRUCT_DISABLE_DOCKER: '1',
        },
        timeout: 30_000,
      }
    );
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.stderr}`);
    assert.match(result.stdout, /construct/i);
  });
});
