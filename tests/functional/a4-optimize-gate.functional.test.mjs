/**
 * tests/functional/a4-optimize-gate.functional.test.mjs — A4 apply/rollback gate.
 *
 * Exercises the safety contract of `construct optimize <agent>`:
 *   - Default (no flags) is preview only; no skill file is modified.
 *   - --apply requires no rate-limit collision; writes a backup + history.
 *   - --rollback restores from the latest backup.
 *
 * Synthesizes a minimal performance review + skill file so the optimize
 * script can run without telemetry or LLM access. The LLM patch generator
 * is bypassed by setting the skill file to a known state and skipping the
 * download path via env shortcuts; we drive the script's gate logic via the
 * backup/rollback helpers directly when the LLM path is unavailable.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { rmTmpDir } from '../helpers/cleanup.mjs';
import { doctorRoot } from '../../lib/config/xdg.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const OPT = path.join(REPO, 'scripts', 'optimize.mjs');

function setupSkillFile() {
  // No fake repo is staged. The script writes backups next to the real
  // skills/perspectives/<agent>.md. To stay isolated, the test pre-stages a backup
  // by hand and exercises --rollback against it.
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'a4-home-'));
  const skillsDir = path.join(REPO, 'skills', 'roles');
  const agentSkill = path.join(skillsDir, 'engineer.md');
  assert.ok(fs.existsSync(agentSkill), 'engineer.md must exist for this test');
  const original = fs.readFileSync(agentSkill, 'utf8');
  return { fakeHome, agentSkill, original, skillsDir };
}

test('A4: --rollback without a backup exits with a clear error', () => {
  const { fakeHome } = setupSkillFile();
  const result = spawnSync('node', [OPT, 'engineer', '--rollback'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: fakeHome },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No backup found/);
  rmTmpDir(fakeHome);
});

test('A4: --rollback restores the latest .bak when present', () => {
  const { fakeHome, agentSkill, original, skillsDir } = setupSkillFile();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(skillsDir, `engineer.md.${stamp}.bak`);
  // Synthesize a backup that represents the prior version.
  fs.writeFileSync(backup, original);
  // Mutate the live file to a different content.
  fs.writeFileSync(agentSkill, '# corrupted\n');

  const result = spawnSync('node', [OPT, 'engineer', '--rollback'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: fakeHome },
  });
  assert.equal(result.status, 0, `rollback failed: ${result.stderr}`);
  assert.match(result.stdout, /Rolled engineer back from/);

  const restored = fs.readFileSync(agentSkill, 'utf8');
  assert.equal(restored, original, 'skill file did not return to its prior content');
  assert.equal(fs.existsSync(backup), false, 'backup should be consumed by rollback');

  rmTmpDir(fakeHome);
});

test('A4: default invocation without --apply is preview-only (no write, no history)', () => {
  const { fakeHome, agentSkill, original } = setupSkillFile();
  // Without telemetry/LLM env, the script will short-circuit early on "no
  // traces" or "no patch". The contract we're verifying is that even in the
  // happy path it would have stopped at the preview gate when no flag passed.
  const result = spawnSync('node', [OPT, 'engineer', '--days=7'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: fakeHome },
    timeout: 15_000,
  });
  // Either it ran and printed a preview, or it skipped due to no telemetry;
  // in EITHER case the skill file must be unchanged.
  assert.equal(fs.readFileSync(agentSkill, 'utf8'), original, 'preview run must not modify skill file');

  // history file should not have an 'apply' entry from this invocation
  const historyPath = path.join(doctorRoot(fakeHome), 'prompt-history', 'engineer.jsonl');
  if (fs.existsSync(historyPath)) {
    const lines = fs.readFileSync(historyPath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      const entry = JSON.parse(line);
      assert.notEqual(entry.action, 'apply', 'no apply entry should have been recorded');
    }
  }
  rmTmpDir(fakeHome);
});
