/**
 * tests/secret-audit-wiring.test.mjs
 *
 * Guards construct-trxz.6 wiring: enableSecretAuditTrail records each actual op://
 * resolution into the durable audit trail (ref + outcome, never the value) and does
 * not record cache hits.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  resolveSecret,
  __resetSecretAuditSink,
  __clearSecretCache,
} from '../lib/providers/secret-resolver.mjs';
import { enableSecretAuditTrail } from '../lib/providers/secret-audit-wiring.mjs';

const RESOLVED = 'resolved-canary-zzz-not-a-key';

test('enableSecretAuditTrail records actual op reads without the value, skips cache hits', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-secret-audit-'));
  const file = path.join(dir, 'audit-trail.jsonl');
  t.after(() => {
    __resetSecretAuditSink();
    __clearSecretCache();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  enableSecretAuditTrail({ file });

  const opRead = () => RESOLVED;
  const env = { ANTHROPIC_API_KEY: 'op://Vault/Item/credential' };

  resolveSecret('ANTHROPIC_API_KEY', { env, opRead });
  resolveSecret('ANTHROPIC_API_KEY', { env, opRead });

  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const reads = lines.filter((r) => r.tool === 'secret-resolver' && r.action === 'op_read');
  assert.equal(reads.length, 1, 'exactly one actual op read is recorded (cache hit is skipped)');
  assert.equal(reads[0].ref, 'op://Vault/Item/credential');
  assert.equal(reads[0].ok, true);
  assert.equal(fs.readFileSync(file, 'utf8').includes(RESOLVED), false, 'the resolved value is never written to the trail');
});
