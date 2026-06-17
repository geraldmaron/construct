#!/usr/bin/env node
/**
 * scripts/run-capability-tests.mjs — Targeted runner for registry-backed capability tests.
 *
 * Usage:
 *   node scripts/run-capability-tests.mjs --surface=opencode --tier=P0
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const matrixPath = join(root, "tests", "registry", "capability-matrix.json");

const args = process.argv.slice(2);
const surfaceFlag = args.find(a => a.startsWith("--surface="))?.split("=")[1];
const tierFlag = args.find(a => a.startsWith("--tier="))?.split("=")[1];

if (!existsSync(matrixPath)) {
  console.error("Capability matrix not found.");
  process.exit(1);
}

const matrix = JSON.parse(readFileSync(matrixPath, "utf8"));

const tasks = [];

for (const cap of matrix.capabilities) {
  if (tierFlag && cap.criticality !== tierFlag) continue;
  
  for (const [surface, status] of Object.entries(cap.surfaces)) {
    if (surfaceFlag && surface !== surfaceFlag) continue;
    if (!status.supported) continue;

    tasks.push({ capId: cap.id, surface });
  }
}

console.log(`Running ${tasks.length} capability tests...`);

let passedCount = 0;

for (const task of tasks) {
  console.log(`\n[${task.capId}] Testing surface: ${task.surface}`);
  
  // Convention: Test files live in tests/capabilities/<id>/<surface>.test.mjs
  const testFile = join("tests", "capabilities", task.capId, `${task.surface}.test.mjs`);
  
  if (!existsSync(join(root, testFile))) {
    console.warn(`⚠️ Test file missing: ${testFile}`);
    continue;
  }

  const result = spawnSync(process.execPath, ["--test", testFile], {
    stdio: "inherit",
    env: { ...process.env, CX_TEST_SURFACE: task.surface, CX_TEST_CAPABILITY: task.capId }
  });

  if (result.status === 0) {
    passedCount++;
    // Update matrix
    const cap = matrix.capabilities.find(c => c.id === task.capId);
    cap.surfaces[task.surface].last_validated = new Date().toISOString();
    // In a real scenario, the test would output a quality score we parse.
    // For now, we stub it to 1.0 on pass.
    cap.surfaces[task.surface].quality_score = 1.0;
  }
}

writeFileSync(matrixPath, JSON.stringify(matrix, null, 2));

console.log(`\nDone. ${passedCount}/${tasks.length} tests passed.`);
process.exit(passedCount === tasks.length ? 0 : 1);
