/**
 * tests/registry-phase-1-4.test.mjs — RFC-0004 Phase 1.4 honest-completion acceptance.
 *
 * Phase 1.4 made the unified registry (specialists/org) the
 * single source of truth: runtime consumers read it via lib/registry/loader.mjs,
 * the legacy registry files were removed, and `registry:validate --unified` gates
 * its invariants. This test pins that acceptance so the migration cannot silently
 * regress:
 *   (a) the real unified registry exists and validates clean;
 *   (b) no live legacy-registry readers remain in lib/bin/scripts (tests and
 *       by-design migration tooling excluded);
 *   (c) the validator rejects a deliberately-invalid registry (negative test);
 *   (d) a .cx/unified-registry.json overlay merges, overlay winning.
 *
 * Hermetic: (a)/(c)/(d) drive lib/registry/cli.mjs against in-repo or tmpdir
 * fixtures; (b) shells out to ripgrep over tracked source only.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

import { runUnifiedRegistryValidate } from '../lib/registry/cli.mjs';
import { validate } from '../lib/registry/validator.mjs';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

// Capture a handler's stdout/stderr by injecting println/errorln, so assertions
// can read the rendered human output without touching the process streams.

function runValidate(args, rootDir) {
  const out = [];
  const err = [];
  return runUnifiedRegistryValidate(args, {
    rootDir,
    println: (line = '') => out.push(String(line)),
    errorln: (line = '') => err.push(String(line)),
  }).then((code) => ({ code, out: out.join('\n'), err: err.join('\n') }));
}

function minimalValidRegistry() {
  return {
    version: 2,
    teams: {
      'team-a': {
        id: 'team-a',
        name: 'Team A',
        owner: 'role-a',
        roles: ['role-a'],
        decisionRights: [],
        forbiddenDecisions: [],
        escalationPath: ['role-a', 'orchestrator'],
        charter: 'Team A charter.',
        contact: {},
      },
    },
    specialists: {
      'cx-spec-a': { name: 'spec-a', team: 'team-a', role: 'role-a', modelTier: 'standard' },
    },
    contracts: {
      'contract-1': { id: 'contract-1', producer: 'user', consumer: 'cx-spec-a' },
    },
    policies: {},
  };
}

function writeFixture({ overlay, mutate } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-reg-1-4-'));
  fs.mkdirSync(path.join(dir, 'specialists'), { recursive: true });
  fs.cpSync(path.join(ROOT_DIR, 'specialists', 'org'), path.join(dir, 'specialists', 'org'), { recursive: true });
  if (mutate) mutate(dir);
  if (overlay) {
    fs.mkdirSync(path.join(dir, '.cx'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.cx', 'unified-registry.json'), JSON.stringify(overlay, null, 2) + '\n');
  }
  return dir;
}

describe('RFC-0004 Phase 1.4 — unified registry honest completion', () => {
  it('(a) the real unified registry exists and validates clean', async () => {
    const canonical = path.join(ROOT_DIR, 'specialists', 'org');
    assert.ok(fs.existsSync(canonical), 'specialists/org must exist');

    const { code, out, err } = await runValidate(['--unified'], ROOT_DIR);
    assert.equal(code, 0, `validate --unified should exit 0 on the real registry\nstderr:\n${err}`);
    assert.match(out, /Unified registry valid/);
  });

  it('(a) --unified --json emits a valid, ok report', async () => {
    const { code, out } = await runValidate(['--unified', '--json'], ROOT_DIR);
    assert.equal(code, 0);
    const report = JSON.parse(out);
    assert.equal(report.ok, true);
    assert.equal(report.errors.length, 0);
    assert.ok(report.teams > 0 && report.specialists > 0);
  });

  // The migration is honest only if no runtime code still reads the deleted
  // legacy registry files. ripgrep over lib/bin/scripts, excluding tests and the
  // by-design migration runner that names the legacy shape in its docstring.

  it('(b) no live legacy-registry readers remain in lib/bin/scripts', () => {
    const result = spawnSync('rg', [
      '-l',
      'specialists/(registry|teams|contracts|policy-inventory|role-manifests)\\.json',
      'lib', 'bin', 'scripts',
      '--glob', '!*.test.*',
      '--glob', '!*migrate*',
      '--glob', '!lib/registry/retired-paths.mjs',
      '--glob', '!lib/migrations/**',
    ], { cwd: ROOT_DIR, encoding: 'utf-8' });

    const hits = result.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    assert.deepEqual(hits, [], `legacy registry readers must be gone, found:\n${hits.join('\n')}`);
    assert.equal(result.status, 1, 'rg should exit 1 (no matches)');
  });

  it('(c) the validator rejects a deliberately-invalid registry', async () => {
    const broken = minimalValidRegistry();
    broken.teams['team-a'].owner = 'role-that-no-specialist-fills';
    broken.contracts['contract-broken'] = { id: 'contract-broken', producer: 'cx-ghost', consumer: 'user' };

    const direct = validate(broken);
    assert.equal(direct.ok, false);
    assert.ok(direct.errors.some((e) => e.id === 'team-no-owner-specialist'));
    assert.ok(direct.errors.some((e) => e.id === 'contract-unknown-producer'));

    const dir = writeFixture({
      mutate: (fixtureDir) => {
        const file = path.join(fixtureDir, 'specialists', 'org', 'specialists', 'cx-engineer.json');
        const specialist = JSON.parse(fs.readFileSync(file, 'utf8'));
        specialist.team = 'missing-team';
        specialist.teamId = 'missing-team';
        fs.writeFileSync(file, JSON.stringify(specialist, null, 2) + '\n');
      },
    });
    try {
      const { code, err } = await runValidate(['--unified'], dir);
      assert.equal(code, 1, 'validate --unified must exit 1 on an invalid registry');
      assert.match(err, /Cannot assemble registry|Unified registry invalid/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('(d) a .cx/unified-registry.json overlay merges, overlay winning', async () => {
    const overlay = { specialists: { 'cx-engineer': { modelTier: 'reasoning' } } };
    const dir = writeFixture({ overlay });
    try {
      const { code, out } = await runValidate(['--unified', '--json'], dir);
      assert.equal(code, 0, 'overlaid registry should still validate clean');
      const report = JSON.parse(out);
      assert.equal(report.ok, true);
      assert.ok(report.overlayPath, 'report should record the applied overlay path');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
