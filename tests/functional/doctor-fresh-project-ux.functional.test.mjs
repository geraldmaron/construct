/**
 * doctor-fresh-project-ux.functional.test.mjs — fresh init doctor should not
 * warn about hosts the user has not installed, should sort failures first, and
 * should surface suggested next steps.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const BIN = path.join(REPO, 'bin', 'construct');

test('doctor after init omits uninstalled host config warnings and lists next steps', () => {
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-fresh-'));
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-fresh-home-'));
  const proj = path.join(fakeRoot, 'proj');
  fs.mkdirSync(proj, { recursive: true });

  try {
    spawnSync('git', ['init', '-q'], { cwd: proj });
    const init = spawnSync(BIN, ['init', '--yes', '--no-start'], {
      cwd: proj,
      env: {
        ...process.env,
        HOME: fakeHome,
        CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
        BOOTSTRAP_CHECKED: '1',
        CONSTRUCT_DISABLE_AUTO_CLEANUP: '1',
        npm_config_devdir: '',
        NPM_CONFIG_DEVDIR: '',
      },
      encoding: 'utf8',
      timeout: 120000,
    });
    assert.equal(init.status, 0, `init failed:\n${init.stdout}\n${init.stderr}`);

    const result = spawnSync(BIN, ['doctor'], {
      cwd: proj,
      env: {
        ...process.env,
        HOME: fakeHome,
        CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
        BOOTSTRAP_CHECKED: '1',
        CONSTRUCT_DISABLE_AUTO_CLEANUP: '1',
        npm_config_devdir: '',
        NPM_CONFIG_DEVDIR: '',
      },
      encoding: 'utf8',
      timeout: 120000,
    });

    assert.equal(result.status, 0, `doctor failed:\n${result.stdout}\n${result.stderr}`);
    assert.ok(result.stdout.includes('Suggested next steps'), 'should list actionable next steps');
    assert.match(
      result.stdout,
      /Workspace Preset: \S+ \(.*\) — `construct workspace-preset show`/,
      'doctor should echo the active workspace preset with a show hint',
    );
    assert.ok(
      result.stdout.includes('Document export engines:'),
      'should summarize export engines in one line by default',
    );
    assert.ok(
      result.stdout.includes('Docling runtime: optional, not provisioned'),
      'docling absence should be informational, not a warning',
    );
    assert.ok(
      !result.stdout.includes('Docling runtime not provisioned (`construct install --with-docling`, or auto on first ingest)'),
      'old docling warning copy should be gone',
    );

    const opencodeProbe = spawnSync('sh', ['-lc', 'command -v opencode'], { encoding: 'utf8' });
    if (opencodeProbe.status !== 0) {
      assert.ok(!result.stdout.includes('OpenCode config exists'), 'should not mention OpenCode when binary absent');
    }

    const lines = result.stdout.split('\n').filter((l) => l.trim().startsWith('  '));
    const firstCheck = lines.find((l) => l.includes('Models —') || l.includes('User config'));
    const lastPass = lines.findLast((l) => l.endsWith('✓'));
    if (firstCheck && lastPass) {
      const firstIdx = result.stdout.indexOf(firstCheck);
      const lastPassIdx = result.stdout.indexOf(lastPass);
      assert.ok(firstIdx < lastPassIdx, 'action items should appear before trailing passes when sorted');
    }
  } finally {
    rmTmpDir(fakeRoot);
    rmTmpDir(fakeHome);
  }
});
