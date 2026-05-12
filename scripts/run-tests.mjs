#!/usr/bin/env node
/**
 * scripts/run-tests.mjs — Cross-platform test runner.
 *
 * PowerShell on Windows does not expand shell globs, so `tests/*.test.mjs`
 * fails on the Windows CI matrix. This script enumerates test files in Node
 * and forwards them to `node --test`, behaving identically across platforms.
 *
 * Pass --coverage (or -c) to enable experimental coverage reporting.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const testsDir = path.join(cwd, "tests");

const args = process.argv.slice(2);
const coverageIdx = args.findIndex((a) => a === "--coverage" || a === "-c");
const enableCoverage = coverageIdx !== -1;
if (enableCoverage) args.splice(coverageIdx, 1);

const entries = readdirSync(testsDir, { withFileTypes: true });
const topLevel = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
  .map((entry) => path.join("tests", entry.name));

const subdirs = entries
  .filter((entry) => entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "fixtures")
  .flatMap((entry) => {
    const dirPath = path.join(testsDir, entry.name);
    return readdirSync(dirPath, { withFileTypes: true })
      .filter((f) => f.isFile() && f.name.endsWith(".test.mjs"))
      .map((f) => path.join("tests", entry.name, f.name));
  });

const files = [...topLevel, ...subdirs].sort();

if (files.length === 0) {
  console.error(`No test files found in ${testsDir}`);
  process.exit(1);
}

const nodeArgs = ["--test", "--test-concurrency=1"];
if (enableCoverage) {
  nodeArgs.push("--experimental-test-coverage");
}
const result = spawnSync(process.execPath, [...nodeArgs, ...files, ...args], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
