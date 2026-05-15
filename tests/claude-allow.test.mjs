/**
 * claude-allow.test.mjs — tests for ~/.claude/settings.json permissions.allow
 * read / add / remove / gap-detection helpers.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  listAllowEntries,
  addAllowEntries,
  removeAllowEntries,
  detectAllowlistGaps,
  buildPermissionPostureLine,
} from '../lib/claude-allow.mjs';

function tempSettings(initial) {
  const dir = mkdtempSync(join(tmpdir(), 'cx-allow-'));
  const path = join(dir, 'settings.json');
  if (initial !== undefined) writeFileSync(path, JSON.stringify(initial, null, 2));
  return { dir, path };
}

test('listAllowEntries returns [] when settings file is absent', () => {
  const { dir, path } = tempSettings();
  assert.deepEqual(listAllowEntries({ path }), []);
  rmSync(dir, { recursive: true, force: true });
});

test('listAllowEntries returns [] when permissions.allow is missing', () => {
  const { dir, path } = tempSettings({ theme: 'auto' });
  assert.deepEqual(listAllowEntries({ path }), []);
  rmSync(dir, { recursive: true, force: true });
});

test('addAllowEntries adds new entries and dedupes existing', () => {
  const { dir, path } = tempSettings({ permissions: { allow: ['Bash(git merge*)'] } });
  const result = addAllowEntries(['Bash(git merge*)', 'Bash(gh pr create *)'], { path });
  assert.deepEqual(result.added, ['Bash(gh pr create *)']);
  assert.deepEqual(result.existing, ['Bash(git merge*)']);
  const written = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(written.permissions.allow, ['Bash(git merge*)', 'Bash(gh pr create *)']);
  rmSync(dir, { recursive: true, force: true });
});

test('addAllowEntries seeds permissions.allow when the file has no permissions block', () => {
  const { dir, path } = tempSettings({ theme: 'auto' });
  const result = addAllowEntries(['Bash(gh pr view *)'], { path });
  assert.equal(result.added.length, 1);
  assert.equal(result.total, 1);
  const written = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(written.permissions.allow, ['Bash(gh pr view *)']);
  assert.equal(written.theme, 'auto', 'preserves unrelated fields');
  rmSync(dir, { recursive: true, force: true });
});

test('addAllowEntries skips empty / non-string inputs', () => {
  const { dir, path } = tempSettings({ permissions: { allow: [] } });
  const result = addAllowEntries(['', null, undefined, 'Bash(ok)'], { path });
  assert.deepEqual(result.added, ['Bash(ok)']);
  rmSync(dir, { recursive: true, force: true });
});

test('removeAllowEntries removes matched entries and reports missing ones', () => {
  const { dir, path } = tempSettings({ permissions: { allow: ['a', 'b', 'c'] } });
  const result = removeAllowEntries(['b', 'd'], { path });
  assert.deepEqual(result.removed, ['b']);
  assert.deepEqual(result.notFound, ['d']);
  const written = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(written.permissions.allow.sort(), ['a', 'c']);
  rmSync(dir, { recursive: true, force: true });
});

test('addAllowEntries is idempotent — repeat run is a no-op', () => {
  const { dir, path } = tempSettings({ permissions: { allow: [] } });
  const first = addAllowEntries(['Bash(x)'], { path });
  assert.deepEqual(first.added, ['Bash(x)']);
  const second = addAllowEntries(['Bash(x)'], { path });
  assert.deepEqual(second.added, []);
  assert.deepEqual(second.existing, ['Bash(x)']);
  rmSync(dir, { recursive: true, force: true });
});

test('detectAllowlistGaps returns prefix gaps based on current branches', () => {
  // The test runs inside the construct repo worktree which has chore/feat branches;
  // assert the function returns plain-object gaps shape rather than specific
  // values (varies by checkout).
  const { dir, path } = tempSettings({ permissions: { allow: [] } });
  const gaps = detectAllowlistGaps({ cwd: process.cwd(), path });
  for (const g of gaps) {
    assert.ok(typeof g.prefix === 'string' && g.prefix.length > 0);
    assert.ok(g.pattern.startsWith('Bash(git push --force-with-lease origin '));
    assert.ok(g.pattern.endsWith('/*)'));
  }
  rmSync(dir, { recursive: true, force: true });
});

test('detectAllowlistGaps drops prefixes that are already allowlisted', () => {
  const allow = ['Bash(git push --force-with-lease origin chore/*)'];
  const { dir, path } = tempSettings({ permissions: { allow } });
  const gaps = detectAllowlistGaps({ cwd: process.cwd(), path });
  assert.ok(gaps.every((g) => g.prefix !== 'chore'), 'chore/ should be covered');
  rmSync(dir, { recursive: true, force: true });
});

test('buildPermissionPostureLine returns empty string when no gaps', () => {
  // Allow every known prefix → no gaps → empty line.
  const { dir, path } = tempSettings({
    permissions: {
      allow: ['feat', 'fix', 'chore', 'docs', 'refactor', 'perf', 'cleanup', 'test', 'build', 'ci', 'style']
        .map((p) => `Bash(git push --force-with-lease origin ${p}/*)`),
    },
  });
  const line = buildPermissionPostureLine({ cwd: process.cwd(), path });
  assert.equal(line, '');
  rmSync(dir, { recursive: true, force: true });
});

test('buildPermissionPostureLine surfaces gaps with the construct claude:allow hint', () => {
  const { dir, path } = tempSettings({ permissions: { allow: [] } });
  const line = buildPermissionPostureLine({ cwd: process.cwd(), path });
  if (line === '') return; // happens if no recent branches with safe prefixes
  assert.ok(line.includes('## Permission posture'));
  assert.ok(line.includes('construct claude:allow check --apply'));
  rmSync(dir, { recursive: true, force: true });
});
