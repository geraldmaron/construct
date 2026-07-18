/**
 * in-flight-safety-check.mjs — spike F evidence harness.
 *
 * Models directive §11 F's "ability of existing runs to finish safely":
 * a process already running the old transport when a runtime swap lands on
 * disk. Sequence:
 *
 *   1. work/lib/.../index.mjs starts as the OLD (gh-CLI) generation.
 *   2. Child A is spawned; it imports the module (loads OLD) and reports.
 *   3. While Child A sleeps (simulating an in-flight write), this process
 *      overwrites work/lib/.../index.mjs with the NEW (REST) generation —
 *      the runtime swap, landing mid-flight.
 *   4. Child A wakes, imports the *same specifier* again, and reports.
 *   5. Child B is spawned fresh, after the swap; it imports for the first
 *      time and reports.
 *
 * Expected/asserted result: Child A reports OLD both times (Node's ESM
 * module cache is keyed by resolved URL at first import and is never
 * invalidated by a later on-disk change), so an in-flight run is unaffected
 * by a concurrent runtime swap and completes safely. Child B reports NEW,
 * confirming the swap *is* live for anything that starts after it. Run:
 * node in-flight-safety-check.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const workAdapterPath = path.join(here, 'work/lib/providers/contract/adapters/github/index.mjs');
const oldFixture = path.join(here, '../fixtures/index.old-gh-cli.mjs');
const newFixture = path.join(here, '../fixtures/index.new-rest-api.mjs');

function runChild(label) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['child-worker.mjs'], {
      cwd: here,
      env: { ...process.env, INFLIGHT_SLEEP_MS: '1500' },
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => process.stderr.write(`[${label} stderr] ${d}`));
    child.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`${label} exited ${code}`));
      const lines = out.trim().split('\n').map((l) => JSON.parse(l));
      resolve(lines);
    });
  });
}

async function main() {
  fs.copyFileSync(oldFixture, workAdapterPath);
  console.log('setup: work/index.mjs = OLD (gh-CLI) generation');

  const childAPromise = runChild('child-A (in-flight)');

  // The 400ms delay lands inside child A's 1500ms in-flight sleep, so the
  // swap below happens while child A already holds the OLD module in memory.

  await new Promise((r) => setTimeout(r, 400));
  fs.copyFileSync(newFixture, workAdapterPath);
  console.log('swap: work/index.mjs overwritten with NEW (REST) generation while child A is in flight');

  const childALines = await childAPromise;
  console.log('child-A (spawned before the swap, importing throughout):', childALines);

  const childBLines = await runChild('child-B (post-swap)');
  console.log('child-B (spawned after the swap):', childBLines);

  const aFirst = childALines[0].generation;
  const aSecond = childALines[1].generation;
  const bFirst = childBLines[0].generation;

  const ok = aFirst === 'old-gh-cli' && aSecond === 'old-gh-cli' && bFirst === 'new-rest-api' && childALines[1].sameModuleObject === true;

  console.log(`\nresult: child A stayed on "${aFirst}" -> "${aSecond}" across the swap (module-cache identity preserved: ${childALines[1].sameModuleObject}); child B (post-swap) loaded "${bFirst}".`);
  console.log(ok ? 'PASS: an in-flight process is unaffected by a concurrent on-disk runtime swap; only a fresh process picks up the new generation.' : 'FAIL: unexpected generation observed — see raw output above.');
  process.exit(ok ? 0 : 1);
}

main();
