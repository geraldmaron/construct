/**
 * tests/functional/secret-audit-daemon-wiring.functional.test.mjs
 *
 * construct-trxz.13: op reads performed outside the CLI process (which alone wired
 * the audit sink) must land on the durable audit trail. Two guarantees:
 *
 *   1. Cross-process recording: a real spawned Node process that wires the sink via
 *      the shared enableSecretAuditTrail() and then resolves an op:// reference
 *      through a stub `op` writes a value-free op_read record to the trail file the
 *      daemons write (doctorRoot()/audit-trail.jsonl), and never the secret value.
 *   2. Entrypoint coverage: every long-lived Construct process entrypoint wires the
 *      sink, so a credential resolution it performs is recorded rather than escaping.
 *      The MCP server and the embed daemon genuinely resolve provider secrets in
 *      their own process (the real gap the CLI wiring never covered); the doctor and
 *      oracle daemons wire it defensively so a future provider-touching tick is
 *      covered. A regression that drops any of these wirings is caught here.
 *
 * Hermetic: a tmpdir sandbox for HOME + CONSTRUCT_DOCTOR_ROOT and a stub `op` on
 * PATH; no real 1Password prompt and no real host trail is touched. The canary is a
 * hyphenated non-key string so the pre-commit secret scanner does not flag it.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WIRING_MODULE = path.join(REPO_ROOT, 'lib', 'providers', 'secret-audit-wiring.mjs');
const RESOLVER_MODULE = path.join(REPO_ROOT, 'lib', 'providers', 'secret-resolver.mjs');

const OP_CANARY = 'op://Vault/Item/credential';
const RESOLVED_CANARY = 'RESOLVED-CANARY-zz9-not-a-key';

// Long-lived Construct process entrypoints that wire the audit sink. bin/construct
// is the CLI baseline; the MCP server and embed daemon genuinely resolve provider
// secrets in their own process; the doctor daemon wires it defensively. The ACP
// server runs inside `construct acp`, so the CLI wiring already covers it. The
// oracle daemon-entry is gone (construct-b0nny.17): its directive-execution job
// runs under the embed-owned E5 path, whose secret resolution the embed worker
// entry above already covers.
const WIRED_PROCESS_ENTRYPOINTS = [
  'bin/construct',
  'lib/mcp/server.mjs',
  'lib/embed/worker.mjs',
  'lib/doctor/index.mjs',
];

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-trxz13-'));
  t.after(() => { try { rmTmpDir(dir); } catch {} });
  return dir;
}

// A stub `op` that answers `op read op://...` with the canary and nothing else, so
// the resolver's spawnSync('op', ['read', ref]) path materializes deterministically.
function writeStubOp(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  const opPath = path.join(binDir, 'op');
  fs.writeFileSync(opPath, `#!/bin/sh\nif [ "$1" = "read" ]; then printf '%s' '${RESOLVED_CANARY}'; exit 0; fi\nexit 1\n`);
  fs.chmodSync(opPath, 0o755);
}

test('[trxz.13] a spawned process wiring the sink records an op read to the durable trail, value-free', (t) => {
  const dir = sandbox(t);
  const doctorRoot = path.join(dir, 'state');
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(doctorRoot, { recursive: true });
  writeStubOp(binDir);

  // Mirrors what each daemon entrypoint does: wire the sink, then resolve a secret.
  // allowAmbient:false keeps the resolution to the injected op:// so no host file
  // can influence the run; the op:// still materializes through the stub `op`.
  const driver = `
    import { enableSecretAuditTrail } from ${JSON.stringify(WIRING_MODULE)};
    import { resolveSecret } from ${JSON.stringify(RESOLVER_MODULE)};
    enableSecretAuditTrail();
    const value = resolveSecret('ANTHROPIC_API_KEY', {
      env: { ANTHROPIC_API_KEY: '${OP_CANARY}' },
      allowAmbient: false,
    });
    if (value !== '${RESOLVED_CANARY}') {
      process.stderr.write('stub op did not resolve: ' + String(value) + '\\n');
      process.exit(2);
    }
  `;

  const env = { ...process.env, CONSTRUCT_DOCTOR_ROOT: doctorRoot, HOME: dir, PATH: `${binDir}:${process.env.PATH}` };
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', driver], { encoding: 'utf8', timeout: 60_000, env });
  assert.equal(result.status, 0, `driver should exit cleanly: ${result.stderr || result.stdout}`);

  const trail = path.join(doctorRoot, 'audit-trail.jsonl');
  assert.ok(fs.existsSync(trail), 'the daemon-scoped audit trail file should exist after an op read');
  const raw = fs.readFileSync(trail, 'utf8');
  const records = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));

  const opReads = records.filter((r) => r.tool === 'secret-resolver' && r.action === 'op_read');
  assert.equal(opReads.length, 1, 'exactly one op_read record is written for the single resolution');
  assert.equal(opReads[0].ref, OP_CANARY, 'the record carries the op:// reference');
  assert.equal(opReads[0].ok, true, 'the op_read is recorded as successful');

  assert.equal(raw.includes(RESOLVED_CANARY), false, 'the resolved secret value must never appear in the trail');
});

test('[trxz.13] every long-lived process entrypoint wires enableSecretAuditTrail', () => {
  const missing = [];
  for (const rel of WIRED_PROCESS_ENTRYPOINTS) {
    const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    const imports = /\benableSecretAuditTrail\b[^;]*from\s*['"][^'"]*secret-audit-wiring\.mjs['"]/.test(src);
    const calls = /enableSecretAuditTrail\s*\(/.test(src);
    if (!imports || !calls) missing.push(rel);
  }
  assert.deepEqual(missing, [], `process entrypoints missing the audit-sink wiring: ${missing.join(', ')}`);
});
