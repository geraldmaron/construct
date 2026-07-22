/**
 * tests/retired-namespace-nonruntime.test.mjs — shipped non-runtime namespace ratchet.
 *
 * Commands, host templates, and public schemas must advertise only the current
 * Construct project namespace. Historical decision records are outside this scan.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');
const ROOTS = ['commands', 'platforms', 'schemas'];
const RETIRED_PATH = /(?:~\/)?\.cx(?:\/|\b)/g;

function filesBelow(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) filesBelow(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

test('shipped commands, platform templates, and schemas do not advertise the retired namespace', () => {
  const hits = [];
  for (const root of ROOTS) {
    for (const file of filesBelow(path.join(ROOT, root))) {
      const relative = path.relative(ROOT, file).split(path.sep).join('/');
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (RETIRED_PATH.test(line)) hits.push(`${relative}:${index + 1}: ${line.trim()}`);
        RETIRED_PATH.lastIndex = 0;
      });
    }
  }

  assert.deepEqual(hits, [], `retired .cx path guidance remains:\n${hits.join('\n')}`);
});
