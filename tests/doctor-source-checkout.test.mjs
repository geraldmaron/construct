/**
 * tests/doctor-source-checkout.test.mjs — published-package vs source-checkout detection.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { isConstructSourceCheckout } from '../lib/doctor/source-checkout.mjs';

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-doctor-src-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('isConstructSourceCheckout', () => {
  it('returns true when certification Worker Profile scenarios exist', () => {
    fs.mkdirSync(path.join(tmp, 'tests', 'certification', 'worker-profiles'), { recursive: true });
    assert.equal(isConstructSourceCheckout(tmp), true);
  });

  it('returns false for a minimal published-package layout', () => {
    fs.mkdirSync(path.join(tmp, 'lib'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'specialists'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: '@geraldmaron/construct', bin: { construct: 'bin/construct' } }),
    );
    assert.equal(isConstructSourceCheckout(tmp), false);
  });
});
