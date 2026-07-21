/**
 * tests/doctor-embed-log-path.test.mjs — embed daemon log size check in
 * cmdDoctor must resolve paths via doctorRoot() (default homedir), not an
 * undefined userHome identifier that crashes before any findings print.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const constructSrc = fs.readFileSync(path.join(ROOT, 'bin', 'construct'), 'utf8');

test('cmdDoctor embed log check uses doctorRoot() default, not userHome', () => {
  assert.doesNotMatch(constructSrc, /doctorRoot\(userHome\)/);
  assert.match(constructSrc, /join\(doctorRoot\(\), 'runtime', 'embed-daemon\.log'\)/);
});
