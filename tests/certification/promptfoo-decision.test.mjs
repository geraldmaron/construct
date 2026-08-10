/**
 * tests/certification/promptfoo-decision.test.mjs — promptfoo adoption decision guardrails.
 */

import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('package.json does not list promptfoo in runtime or dev dependencies', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  const sections = ['dependencies', 'devDependencies', 'optionalDependencies'];
  for (const section of sections) {
    const deps = pkg[section] ?? {};
    assert.equal(deps.promptfoo, undefined, `promptfoo must not appear in ${section}`);
  }
});

test('no lib/ module imports promptfoo', () => {
  const libDir = path.join(REPO, 'lib');
  const stack = [libDir];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(abs);
      else if (entry.name.endsWith('.mjs') || entry.name.endsWith('.js')) {
        const text = fs.readFileSync(abs, 'utf8');
        assert.doesNotMatch(text, /from ['"]promptfoo/, `${path.relative(REPO, abs)} imports promptfoo`);
      }
    }
  }
});
