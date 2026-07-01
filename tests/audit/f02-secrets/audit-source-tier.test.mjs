/**
 * tests/audit/f02-secrets/audit-source-tier.red.mjs — F02 audit-trail records source TIER,
 * never the secret VALUE, for every resolution — including non-op plaintext reads.
 *
 * RED fixture (must FAIL against current code). secret-resolver emits a value-free
 * `secret.resolve` event carrying the source tier for EVERY resolution
 * (lib/providers/secret-resolver.mjs:211 / :223 / :229). enableSecretAuditTrail
 * (lib/providers/secret-audit-wiring.mjs:19) returns early on anything that is not a
 * `secret.op_read`, so a plaintext key resolved from config.env / project .env / shell rc
 * — the common case — produces NO durable audit record. The audit requirement is that
 * resolution logs the source tier (not the value); today the only tier ever persisted is
 * the op:// path, leaving plaintext-tier resolutions unaudited.
 *
 * Two facts are pinned: (1) a non-op resolution writes a durable record naming its source
 * tier; (2) that record never contains the materialized value.
 *
 * Turns GREEN once enableSecretAuditTrail also persists a value-free record for
 * `secret.resolve` events (source tier + outcome), per CX-AUDIT-SECRETS-005 / plan Epic 6
 * (docs/notes/research/2026-06-construct-audit/90-credential-handling-remediation-plan.md
 * §"Audited: never ... zero structured audit/observation events on the resolve path").
 *
 * The resolver reads files relative to cwd and os.homedir(); the probe key is supplied on
 * the project .env inside an isolated tmp cwd and resolved with allowAmbient, so no real
 * host state is read or written. The audit sink is reset via t.after.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  resolveSecret,
  __resetSecretAuditSink,
  __clearSecretCache,
} from '../../../lib/providers/secret-resolver.mjs';
import { enableSecretAuditTrail } from '../../../lib/providers/secret-audit-wiring.mjs';

// A plaintext (non-op) value with a marker that cannot collide with field names, so a
// substring scan over the persisted record is an unambiguous value-leak check.

const PLAINTEXT_SECRET = 'plaintext-secret-VALUE-zzz9';

test('non-op secret resolution records its source tier in the durable audit trail, never the value', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-f02-audit-tier-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-f02-audit-proj-'));
  const file = path.join(dir, 'audit-trail.jsonl');

  t.after(() => {
    __resetSecretAuditSink();
    __clearSecretCache();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  });

  fs.writeFileSync(path.join(project, '.env'), `AUDIT_TIER_PROBE=${PLAINTEXT_SECRET}\n`, 'utf8');
  enableSecretAuditTrail({ file });

  // Resolve from the project .env tier (not env, not op://) so the event under test is a
  // plaintext `secret.resolve` with source: 'project-env'.
  const value = resolveSecret('AUDIT_TIER_PROBE', { env: {}, cwd: project, allowAmbient: true });
  assert.equal(value, PLAINTEXT_SECRET, 'resolver returned the planted value (sanity)');

  assert.ok(fs.existsSync(file), 'no durable audit record was written for a non-op resolution');

  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(/project-env/.test(raw), 'audit record must name the source tier (project-env) of the resolution');
  assert.ok(!raw.includes(PLAINTEXT_SECRET), 'audit record must never contain the materialized secret value');
});
