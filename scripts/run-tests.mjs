#!/usr/bin/env node
/**
 * scripts/run-tests.mjs — Cross-platform test runner.
 *
 * PowerShell on Windows does not expand shell globs, so `tests/*.test.mjs`
 * fails on the Windows CI matrix. This script enumerates test files in Node
 * and forwards them to `node --test`, behaving identically across platforms.
 *
 * Pass --coverage (or -c) to enable experimental coverage reporting.
 *
 * Sterility guard: the suite is fingerprinted against the real user tool
 * configs (~/.config/opencode/opencode.json, ~/.claude/settings.json, the
 * Ollama model store) before and after the run. Any test that leaks a write
 * into real host state — the failure mode that polluted live configs during the
 * local-model investigation — fails the whole run. Tests that touch host state
 * must isolate via tests/helpers/sterile-host-env.mjs.
 *
 * Read-hermeticity: beyond XDG, clearHermeticEnvVars() blanks the provider-key
 * and model-tier families (CX_MODEL_ and CONSTRUCT_MODEL_ tiers, ANTHROPIC/OPENAI/
 * OPENROUTER_API_KEY, WEB_SEARCH_URL, CX_USER_ENV_PATH,
 * CONSTRUCT_PROVIDER_TIMEOUT_MS, CONSTRUCT_TELEMETRY_URL) before spawning
 * `node --test`, so a developer's ambient shell can't leak into a suite that
 * spreads `...process.env`. Opt-in live-LLM suites (tests/certification,
 * tests/functional/real-llm-scenarios.functional.test.mjs) gate on the
 * CONSTRUCT_CERTIFY_LIVE=1 / CONSTRUCT_E2E_REAL_LLM=1 flags, not on ambient key
 * presence, so this scrub does not disable them.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { snapshotRealConfigs, diffRealConfigs } from "../tests/helpers/sterile-host-env.mjs";
import { clearXdgVars } from "../lib/test-env-setup.mjs";

const cwd = process.cwd();
const testsDir = path.join(cwd, "tests");

// Clear XDG vars to ensure test isolation. See lib/test-env-setup.mjs for details.
clearXdgVars();

const HERMETIC_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "CX_MODEL_REASONING",
  "CX_MODEL_STANDARD",
  "CX_MODEL_FAST",
  "CONSTRUCT_MODEL_REASONING",
  "CONSTRUCT_MODEL_STANDARD",
  "CONSTRUCT_MODEL_FAST",
  "CONSTRUCT_PROVIDER_TIMEOUT_MS",
  "WEB_SEARCH_URL",
  "CX_USER_ENV_PATH",
  "CONSTRUCT_TELEMETRY_URL",
];

function clearHermeticEnvVars(env = process.env) {
  for (const key of HERMETIC_ENV_VARS) delete env[key];
}

clearHermeticEnvVars();

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
const sterileBefore = snapshotRealConfigs();

const result = spawnSync(process.execPath, [...nodeArgs, ...files, ...args], {
  stdio: "inherit",
});

// A non-zero test status already fails the run; still check sterility so a
// leak is reported even when tests otherwise pass. A drift here means a test
// wrote into real host config instead of an isolated sandbox. On a developer
// machine that is a hard failure — the guard exists to protect real,
// long-lived host state. On an ephemeral CI runner (CI=true) there is no
// real machine to protect, so the same drift downgrades to a warning that
// names the exact project keys added/removed — the attribution data the
// per-test isolation backlog (construct-mtgs) needs — without blocking an
// otherwise-green run. This is the wrong-context detection CLAUDE.md's
// hook policy prescribes for notice-shaped signals, not a skip switch:
// dev machines keep the hard gate unconditionally.

const drift = diffRealConfigs(sterileBefore);
if (drift.drifted.length) {
  const detail = [
    `Sterile drift — real host config changed: ${drift.drifted.join(", ")}`,
    drift.addedProjectKeys.length ? `  project keys added:   ${drift.addedProjectKeys.join(", ")}` : null,
    drift.removedProjectKeys.length ? `  project keys removed: ${drift.removedProjectKeys.join(", ")}` : null,
  ].filter(Boolean).join("\n");
  if (process.env.CI === "true") {
    console.warn(`\n[sterile-guard] WARNING (non-blocking on CI): ${detail}`);
    console.warn("[sterile-guard] A test leaked outside its sandbox. Track the offender via construct-mtgs; the keys above identify the leaked state.");
  } else {
    console.error(`\n${detail}`);
    console.error("A test mutated real host config. Isolate it via tests/helpers/sterile-host-env.mjs.");
    process.exit(1);
  }
}

process.exit(result.status ?? 1);
