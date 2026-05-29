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

// --exclude=<path-fragment> drops every test file whose normalized path
// includes the fragment. `npm run test:unit` uses --exclude=tests/functional
// to skip heavier suites (Docker, real http servers, live LLMs).

const excludePrefixes = [];
for (let i = args.length - 1; i >= 0; i--) {
  const arg = args[i];
  if (typeof arg === "string" && arg.startsWith("--exclude=")) {
    excludePrefixes.push(arg.slice("--exclude=".length));
    args.splice(i, 1);
  }
}

function isExcluded(filePath) {
  if (excludePrefixes.length === 0) return false;
  const normalized = filePath.split(path.sep).join("/");
  return excludePrefixes.some((p) => normalized.includes(p));
}

const entries = readdirSync(testsDir, { withFileTypes: true });
const topLevel = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
  .map((entry) => path.join("tests", entry.name));

function walkRecursive(dir, baseRel) {
  const out = [];
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    const rel = path.join(baseRel, f.name);
    if (f.isDirectory()) {
      if (f.name === "node_modules" || f.name === "fixtures") continue;
      out.push(...walkRecursive(full, rel));
    } else if (f.isFile() && f.name.endsWith(".test.mjs")) {
      out.push(rel);
    }
  }
  return out;
}

const subdirs = entries
  .filter((entry) => entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "fixtures")
  .flatMap((entry) => walkRecursive(path.join(testsDir, entry.name), path.join("tests", entry.name)));

const files = [...topLevel, ...subdirs].sort().filter((f) => !isExcluded(f));

if (files.length === 0) {
  console.error(`No test files found in ${testsDir}`);
  process.exit(1);
}

// Default 30s per-test; raise to 180s when sweeping the dashboard-build or
// LLM suites (Next.js cold build + live OpenRouter calls routinely exceed
// 30s even with retries). Dedicated CI jobs already pass --test-timeout
// explicitly; this default keeps `npm test` honest on a clean checkout.

const wantsHeavyTimeout = files.some((f) => /(dashboard-build|llm\/|llm\\)/.test(f));
const defaultTimeout = wantsHeavyTimeout ? 180_000 : 30_000;
const nodeArgs = ["--test", `--test-timeout=${defaultTimeout}`];
if (enableCoverage) {
  nodeArgs.push("--experimental-test-coverage");
}
const result = spawnSync(process.execPath, [...nodeArgs, ...files, ...args], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
