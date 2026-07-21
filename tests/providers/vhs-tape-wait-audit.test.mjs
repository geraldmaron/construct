/**
 * tests/providers/vhs-tape-wait-audit.test.mjs — VHS tape deterministic wait audit (construct-tsyfe.5.3).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TAPES_DIR = path.join(REPO, 'templates/demos/tapes');

test('shipped VHS tapes pair post-Enter waits with deterministic Wait patterns', () => {
  for (const file of fs.readdirSync(TAPES_DIR).filter((name) => name.endsWith('.tape'))) {
    const lines = fs.readFileSync(path.join(TAPES_DIR, file), 'utf8').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].trim() !== 'Enter') continue;
      const next = (lines[i + 1] || '').trim();
      const after = (lines[i + 2] || '').trim();
      if (/^Sleep\s+\d/.test(next) && !/^Wait\s/.test(next)) {
        assert.fail(`${file}:${i + 2} Enter is followed by bare Sleep without Wait`);
      }
      if (/^Wait\s/.test(next) && !/^Sleep\s+400ms/.test(after)) {
        assert.fail(`${file}:${i + 2} Wait after Enter should be followed by short Sleep 400ms`);
      }
    }
  }
});
