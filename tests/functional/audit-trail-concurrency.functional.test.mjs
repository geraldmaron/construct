/**
 * tests/functional/audit-trail-concurrency.functional.test.mjs
 *
 * Guards the concurrency fix for the audit-trail hash chain (ij31.25). The
 * chain broke in the field because read-prev-hash and append were separate
 * steps: parallel hook/daemon processes chained off the same predecessor and
 * the second link pointed at a stale tail. This spawns many hook processes
 * CONCURRENTLY against one project trail and asserts the replayed chain has
 * zero broken links — the serial test (chain-integrity) could never catch it.
 *
 * Also asserts the reset boundary: a corrupted prefix seals as legacy and the
 * live segment verifies, while tampering after the boundary is still caught.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { appendAuditRecord, writeChainReset, verifyChain } from '../../lib/audit-trail.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const HOOK = join(REPO_ROOT, 'lib', 'hooks', 'audit-trail.mjs');

function runHook(input, env) {
  return new Promise((resolveP) => {
    const child = spawn(process.execPath, [HOOK], { cwd: input.cwd, env });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolveP({ code, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
}

test('audit-trail chain survives concurrent hook processes', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'cx-audit-conc-'));
  const fakeHome = mkdtempSync(join(tmpdir(), 'cx-audit-home-'));
  mkdirSync(join(projectRoot, '.construct'), { recursive: true });
  const targetFile = join(projectRoot, 'big.md');
  writeFileSync(targetFile, 'X'.repeat(4_000));

  const env = { ...process.env, HOME: fakeHome };

  try {
    const N = 40;
    const results = await Promise.all(Array.from({ length: N }, (_, i) => runHook({
      tool_name: 'Edit',
      cwd: projectRoot,
      session_id: `s${i % 4}`,
      tool_input: { file_path: targetFile, old_string: `m${i}`, new_string: `m${i + 1}` },
    }, env)));

    for (const [i, r] of results.entries()) {
      assert.equal(r.code, 0, `hook ${i} exited ${r.code}: ${r.stderr}`);
    }

    const trail = join(projectRoot, '.construct', 'audit-trail.jsonl');
    const chain = verifyChain(trail);
    assert.equal(chain.verified, N, `expected all ${N} concurrent records, got ${chain.verified}`);
    assert.equal(chain.ok, true, `chain broke under concurrency: ${chain.broken.length} break(s), first at line ${chain.broken[0]?.line}`);
  } finally {
    rmTmpDir(projectRoot);
    rmTmpDir(fakeHome);
  }
});

test('reset boundary seals legacy corruption and re-bases the live chain', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-audit-reset-'));
  const trail = join(dir, 'audit-trail.jsonl');

  try {
    // A concurrency-corrupted prefix: deliberately wrong prev_line_hash links.
    writeFileSync(trail, '');
    for (let i = 0; i < 5; i += 1) {
      appendFileSync(trail, JSON.stringify({ ts: 't', tool: 'Edit', prev_line_hash: i === 0 ? null : `WRONG${i}` }) + '\n');
    }
    assert.equal(verifyChain(trail).ok, false, 'corrupted prefix must fail before reset');

    writeChainReset({ file: trail, reason: 'test-migration' });
    appendAuditRecord({ ts: 't', tool: 'Edit', agent: 'a', target: 'x' }, { file: trail });
    appendAuditRecord({ ts: 't', tool: 'Write', agent: 'a', target: 'y' }, { file: trail });

    const after = verifyChain(trail);
    assert.equal(after.ok, true, `live segment must verify after reset: ${after.broken.length} break(s)`);
    assert.equal(after.legacy, 5, 'the five corrupted records must be sealed as legacy');
    assert.equal(after.verified, 3, 'boundary + two live records replay');

    // Tampering after the boundary is still detected.
    appendFileSync(trail, JSON.stringify({ ts: 't', tool: 'Edit', prev_line_hash: 'TAMPERED' }) + '\n');
    assert.equal(verifyChain(trail).ok, false, 'post-boundary tampering must still break the chain');
  } finally {
    rmTmpDir(dir);
  }
});
