/**
 * tests/adr-stamp-integrity.test.mjs — ADR body-hash drift gate.
 *
 * @enforces ADR-0015
 *
 * `construct doc verify` already checks stamped body_hash integrity; bead
 * construct-wvbf.4 wires it into the suite as a gate so a stamped ADR whose body
 * was edited without re-stamping fails CI rather than drifting unnoticed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

import { hasStamp, verifyStamp } from '../lib/doc-stamp.mjs';

const ADR_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'adr');

test('every stamped ADR passes body_hash verification', () => {
  const failures = [];
  for (const name of fs.readdirSync(ADR_DIR)) {
    if (!name.endsWith('.md')) continue;
    const content = fs.readFileSync(join(ADR_DIR, name), 'utf8');
    if (!hasStamp(content)) continue;
    if (!verifyStamp(content)) failures.push(name);
  }
  assert.deepEqual(failures, [], `stamped ADRs failing body_hash: ${failures.join(', ')}`);
});
