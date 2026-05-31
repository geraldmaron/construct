/**
 * tests/functional/audit-trail-chain-integrity.functional.test.mjs
 *
 * Replays the prev_line_hash chain across enough mutations to force a
 * rotation of the `audit-trail` channel and asserts that:
 *
 *   1. Every record's `prev_line_hash` equals sha256(previous record's full
 *      JSON line), even on the FIRST record after a rotation boundary.
 *   2. The chain across rotated segments + the active file replays without a
 *      single broken link.
 *
 * Earlier behavior: when rotation moved the active file aside, the new file
 * started empty; `readPrevLineHash()` saw size === 0 and returned null;
 * the first record after rotation had `prev_line_hash: null`, leaving the
 * chain detectably broken at the boundary. The fix routes the lookup
 * through `readLastLineAcrossSegments`, which falls back to the most
 * recent rotated segment when the active file is empty (decompressing
 * gzipped segments as needed).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { tmpdir, homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const HOOK = join(REPO_ROOT, 'lib', 'hooks', 'audit-trail.mjs');

function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}

function readAllRecordsAcrossSegments(activePath) {
  const dir = dirname(activePath);
  const base = 'audit-trail.jsonl';
  const segments = readdirSync(dir)
    .filter((f) => /^audit-trail\.\d+\.jsonl(\.gz)?$/.test(f))
    .sort((a, b) => Number(a.match(/\.(\d+)\./)[1]) - Number(b.match(/\.(\d+)\./)[1]));

  const lines = [];
  for (const name of segments) {
    const fullPath = join(dir, name);
    const raw = readFileSync(fullPath);
    const text = name.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
    for (const line of text.split('\n')) {
      if (line) lines.push(line);
    }
  }
  if (readdirSync(dir).includes(base)) {
    const text = readFileSync(activePath, 'utf8');
    for (const line of text.split('\n')) {
      if (line) lines.push(line);
    }
  }
  return lines;
}

test('audit-trail chain replays without breakage across a forced rotation', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'cx-audit-chain-'));
  const fakeHome = mkdtempSync(join(tmpdir(), 'cx-audit-home-'));
  mkdirSync(join(projectRoot, '.cx'), { recursive: true });

  // Stage a fake target file inside the project so audit-trail's content_hash
  // path is exercised (which is what pushes records past the small tail
  // window the original implementation used).
  const targetFile = join(projectRoot, 'big.md');
  writeFileSync(targetFile, 'X'.repeat(48_000));

  // Cap audit-trail to 1 MB via the documented env override. With every
  // record carrying a 32-char sha256 plus a chain hash, 25 mutations
  // comfortably cross the cap and force at least one rotation.
  const env = {
    ...process.env,
    HOME: fakeHome,
    // Tiny cap (~1 KB) forces rotation every few records. Each audit-trail
    // entry is ~250 bytes for a small Edit so 60 iterations cross the cap
    // many times over and exercise multiple rotation boundaries.
    CONSTRUCT_AUDIT_TRAIL_MAX_MB: '0.001',
  };

  try {
    for (let i = 0; i < 60; i++) {
      const input = {
        tool_name: 'Edit',
        cwd: projectRoot,
        tool_input: {
          file_path: targetFile,
          old_string: `marker-${i}`,
          new_string: `marker-${i + 1}`,
        },
      };
      const result = spawnSync(process.execPath, [HOOK], {
        cwd: projectRoot,
        env,
        input: JSON.stringify(input),
        encoding: 'utf8',
        timeout: 15_000,
      });
      assert.equal(result.status, 0, `iteration ${i} exited ${result.status}: ${result.stderr}`);
    }

    const activePath = join(projectRoot, '.cx', 'audit-trail.jsonl');
    const segments = readdirSync(join(projectRoot, '.cx'))
      .filter((f) => /^audit-trail\.\d+\.jsonl(\.gz)?$/.test(f));
    assert.ok(segments.length >= 1, `expected at least one rotated segment, got ${segments.length}: ${segments.join(', ')}`);

    const records = readAllRecordsAcrossSegments(activePath);
    // The audit-trail channel caps surviving rotated segments at maxSegments=4
    // (plus the active file). At ~250 B per record with a ~1 KB cap, the
    // surviving record count stays well below total iterations. Rotation
    // having occurred is asserted above; the chain-integrity loop below is
    // the load-bearing check.
    assert.ok(records.length >= 5, `expected ≥5 surviving records across segments, got ${records.length}`);

    let breaks = 0;
    let firstBreak = null;
    for (let i = 1; i < records.length; i++) {
      const parsed = JSON.parse(records[i]);
      const expected = sha256(records[i - 1]);
      if (parsed.prev_line_hash !== expected) {
        breaks += 1;
        if (firstBreak === null) firstBreak = i;
      }
    }
    assert.equal(
      breaks,
      0,
      `chain broken ${breaks} time(s); first break at record ${firstBreak} of ${records.length}`,
    );

    const firstRecordAfterRotation = JSON.parse(records[records.length - readdirSync(join(projectRoot, '.cx')).filter((f) => f === 'audit-trail.jsonl').length]);
    assert.ok(firstRecordAfterRotation.prev_line_hash, 'first record on a fresh segment must carry a non-null prev_line_hash sourced from the rotated tail');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
  }
});
