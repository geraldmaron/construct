import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { sterile } from './sterile.ts';

test('sterile() roots a fixture in a real tmpdir and cleans it up', () => {
  const fixture = sterile();
  assert.ok(existsSync(fixture.root));
  assert.ok(fixture.paths.stateDir.startsWith(fixture.root));
  fixture.cleanup();
  assert.equal(existsSync(fixture.root), false);
});
