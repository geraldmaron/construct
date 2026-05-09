#!/usr/bin/env node
/**
 * scripts/run-tests.mjs — Cross-platform test runner.
 *
 * PowerShell on Windows does not expand shell globs, so `tests/*.test.mjs`
 * fails on the Windows CI matrix. This script enumerates test files in Node
 * and forwards them to `node --test`, behaving identically across platforms.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const testsDir = path.join(cwd, "tests");

const entries = readdirSync(testsDir, { withFileTypes: true });
const files = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
  .map((entry) => path.join("tests", entry.name))
  .sort();

if (files.length === 0) {
  console.error(`No test files found in ${testsDir}`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--test", "--test-concurrency=1", ...files, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

process.exit(result.status ?? 1);
