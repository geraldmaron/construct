/**
 * mcp-secret-resolution-nonblocking.functional.test.mjs — the MCP CallTool secret
 * path must not freeze the event loop.
 *
 * resolveSecretAsync resolves an op:// reference through `spawn`, so a slow `op read`
 * yields to the event loop instead of blocking it (as the sync resolveSecret does via
 * spawnSync). Uses a fake `op` on PATH that sleeps before printing a canary, and
 * counts timer ticks during resolution: the async path lets ticks fire, the sync path
 * (kept as a negative control) blocks them, proving the harness would catch a
 * regression. No real 1Password is involved.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveSecret, resolveSecretAsync, __clearSecretCache } from '../../lib/providers/secret-resolver.mjs';
import { __resetOpLocateCache } from '../../lib/providers/op-locate.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

function makeSlowOp(delayMs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-op-nonblock-'));
  const opBin = path.join(dir, 'op');
  const secs = (delayMs / 1000).toFixed(2);
  fs.writeFileSync(opBin, `#!/bin/sh\nif [ "$1" = "read" ]; then sleep ${secs}; printf 'canary-secret'; exit 0; fi\nexit 0\n`);
  fs.chmodSync(opBin, 0o755);
  return { dir, opBin };
}

function withFakeOp(t, delayMs) {
  const { dir } = makeSlowOp(delayMs);
  const savedPath = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${savedPath}`;
  __resetOpLocateCache();
  __clearSecretCache();
  t.after(() => {
    process.env.PATH = savedPath;
    __resetOpLocateCache();
    __clearSecretCache();
    rmTmpDir(dir);
  });
}

const OP_REF_ENV = { TEST_KEY: 'op://vault/item/field' };

test('resolveSecretAsync yields to the event loop during a slow op read', async (t) => {
  withFakeOp(t, 800);

  let ticks = 0;
  const interval = setInterval(() => { ticks += 1; }, 20);
  let result;
  try {
    result = await resolveSecretAsync('TEST_KEY', { env: OP_REF_ENV, allowAmbient: false });
  } finally {
    clearInterval(interval);
  }
  assert.equal(result, 'canary-secret');
  assert.ok(ticks > 0, `event loop ticked during the async op read (ticks=${ticks})`);
});

test('the sync resolveSecret blocks the loop — negative control proving the harness is sensitive', async (t) => {
  withFakeOp(t, 800);

  let ticks = 0;
  const interval = setInterval(() => { ticks += 1; }, 20);
  await new Promise((r) => setTimeout(r, 0));
  const before = ticks;
  const result = resolveSecret('TEST_KEY', { env: OP_REF_ENV, allowAmbient: false });
  clearInterval(interval);
  assert.equal(result, 'canary-secret');
  assert.equal(ticks - before, 0, `sync spawnSync blocked the loop; no ticks fired during the read (delta=${ticks - before})`);
});
