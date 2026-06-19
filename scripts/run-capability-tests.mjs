/**
 * scripts/run-capability-tests.mjs — Targeted runner for registry-backed capability tests.
 *
 * Reads registry/capabilities.json (falls back to tests/registry/capability-matrix.json).
 * Stamps lastValidated on passing entries when --stamp is passed.
 *
 * Usage:
 *   node scripts/run-capability-tests.mjs --tier=P0
 *   node scripts/run-capability-tests.mjs --surface=mcp --stamp
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const registryPath = join(root, 'registry', 'capabilities.json');
const legacyPath = join(root, 'tests', 'registry', 'capability-matrix.json');

const args = process.argv.slice(2);
const surfaceFlag = args.find((a) => a.startsWith('--surface='))?.split('=')[1];
const tierFlag = args.find((a) => a.startsWith('--tier='))?.split('=')[1];
const stamp = args.includes('--stamp');

function loadRegistry() {
  if (existsSync(registryPath)) {
    const data = JSON.parse(readFileSync(registryPath, 'utf8'));
    return { path: registryPath, capabilities: data.capabilities ?? [], format: 'registry' };
  }
  if (existsSync(legacyPath)) {
    const data = JSON.parse(readFileSync(legacyPath, 'utf8'));
    return { path: legacyPath, capabilities: data.capabilities ?? [], format: 'legacy' };
  }
  console.error('No capability registry found (registry/capabilities.json).');
  process.exit(1);
}

const { path: outPath, capabilities, format } = loadRegistry();
const tasks = [];

for (const cap of capabilities) {
  if (tierFlag && cap.criticality !== tierFlag) continue;

  const capTest = cap.verification?.functional || cap.verification?.hostEmulation;
  const surfaces = cap.surfaces ?? {};

  if (format === 'registry') {
    if (capTest) {
      tasks.push({ capId: cap.id, surface: surfaceFlag || 'functional', testFile: capTest });
    }
    for (const [surface, status] of Object.entries(surfaces)) {
      if (surfaceFlag && surface !== surfaceFlag) continue;
      if (!status?.supported) continue;
      const tierPath = join('tests', 'capabilities', cap.id, `${surface}.test.mjs`);
      if (existsSync(join(root, tierPath))) {
        tasks.push({ capId: cap.id, surface, testFile: tierPath });
      }
    }
  } else {
    for (const [surface, status] of Object.entries(surfaces)) {
      if (surfaceFlag && surface !== surfaceFlag) continue;
      if (!status.supported) continue;
      tasks.push({ capId: cap.id, surface, testFile: join('tests', 'capabilities', cap.id, `${surface}.test.mjs`) });
    }
  }
}

const unique = [];
const seen = new Set();
for (const t of tasks) {
  const key = `${t.capId}:${t.testFile}`;
  if (seen.has(key)) continue;
  seen.add(key);
  unique.push(t);
}

console.log(`Running ${unique.length} capability test(s)...`);

let passedCount = 0;

for (const task of unique) {
  const abs = join(root, task.testFile);
  if (!existsSync(abs)) {
    console.warn(`⚠️ Test file missing: ${task.testFile}`);
    continue;
  }
  console.log(`\n[${task.capId}] ${task.testFile}`);
  const result = spawnSync(process.execPath, ['--test', task.testFile], {
    stdio: 'inherit',
    env: { ...process.env, CX_TEST_SURFACE: task.surface, CX_TEST_CAPABILITY: task.capId },
  });
  if (result.status === 0) {
    passedCount += 1;
    if (stamp && format === 'registry') {
      const cap = capabilities.find((c) => c.id === task.capId);
      if (cap) cap.lastValidated = new Date().toISOString();
    }
  }
}

if (stamp && format === 'registry') {
  writeFileSync(outPath, `${JSON.stringify({ version: 1, capabilities }, null, 2)}\n`);
}

console.log(`\nDone. ${passedCount}/${unique.length} tests passed.`);
process.exit(passedCount === unique.length && unique.length > 0 ? 0 : unique.length === 0 ? 1 : 1);
