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
 * Sharding: --shard <i>/<n> (or --shard=i/n) selects a deterministic stripe of
 * the sorted file list — file idx runs on shard i when idx % n === i - 1.
 * Striping, not contiguous chunking, because the sorted list clusters heavy
 * suites (tests/functional, tests/visual) into directory blocks that a chunked
 * split would hand to a single shard; striping spreads each block evenly.
 * --exclude composes with --shard: exclusions apply first, then the stripe, so
 * every shard agrees on the list being partitioned. Across shards 1..n the
 * union is the full post-exclude set and sizes differ by at most one, both by
 * construction (see scripts/test-shard.mjs). --list prints the selected files
 * and exits without running them — the shard-partition self-test and local
 * debugging both use it.
 *
 * File filtering: --files-from=<path> reads a newline-separated list of test
 * files from a JSON file (each key is a test path). The filter intersects with
 * the discovered test list AFTER exclusions and BEFORE striping, so every shard
 * partitions the same post-filter set, matching how --exclude composes.
 *
 * Sterility guard: the suite is fingerprinted against the real user tool
 * configs (~/.config/opencode/opencode.json, ~/.claude/settings.json, the
 * Ollama model store) before and after the run. Any test that leaks a write
 * into real host state — the failure mode that polluted live configs during the
 * local-model investigation — fails the whole run. Tests that touch host state
 * must isolate via tests/helpers/sterile-host-env.mjs.
 *
 * Read-hermeticity: beyond XDG, clearHermeticEnvVars() blanks the provider-key
 * and model-tier families (CONSTRUCT_MODEL_ and CONSTRUCT_MODEL_ tiers, ANTHROPIC/OPENAI/
 * OPENROUTER_API_KEY, WEB_SEARCH_URL, CONSTRUCT_USER_ENV_PATH,
 * CONSTRUCT_PROVIDER_TIMEOUT_MS, CONSTRUCT_TELEMETRY_URL) before spawning
 * `node --test`, so a developer's ambient shell can't leak into a suite that
 * spreads `...process.env`. Opt-in live-LLM suites (tests/certification,
 * tests/functional/real-llm-scenarios.functional.test.mjs) gate on the
 * CONSTRUCT_CERTIFY_LIVE=1 / CONSTRUCT_E2E_REAL_LLM=1 flags, not on ambient key
 * presence, so this scrub does not disable them.
 *
 * Batched execution: `node --test` accumulates every file's module graph and
 * test state in ONE process, so handing it the whole ~900-file suite at once
 * exhausted memory and the process was SIGKILLed (construct-ox25y) — the run
 * never finished and every release:check step after it never ran. The selected
 * files run in bounded sequential batches of fresh child processes instead
 * (CONSTRUCT_TEST_BATCH_SIZE, default 120); memory is released between batches and the
 * aggregate status is non-zero if any batch fails. --shard composes (its subset
 * is simply batched within), and --coverage stays single-process because
 * per-batch coverage reports do not merge.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { snapshotRealConfigs, diffRealConfigs } from "../tests/helpers/sterile-host-env.mjs";
import { clearXdgVars } from "../lib/test-env-setup.mjs";
import { parseShardArgs, stripeFiles } from "./test-shard.mjs";

const cwd = process.cwd();
const testsDir = path.join(cwd, "tests");

// Clear XDG vars to ensure test isolation. See lib/test-env-setup.mjs for details.
clearXdgVars();

const HERMETIC_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "CONSTRUCT_MODEL_REASONING",
  "CONSTRUCT_MODEL_STANDARD",
  "CONSTRUCT_MODEL_FAST",
  "CONSTRUCT_MODEL_REASONING",
  "CONSTRUCT_MODEL_STANDARD",
  "CONSTRUCT_MODEL_FAST",
  "CONSTRUCT_PROVIDER_TIMEOUT_MS",
  "WEB_SEARCH_URL",
  "CONSTRUCT_USER_ENV_PATH",
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

// --files-from=<path> reads a JSON file where each key is a test file path.
// Intersects with the discovered tests AFTER exclusions and BEFORE sharding.

let filesFromSet = null;
for (let i = args.length - 1; i >= 0; i--) {
  const arg = args[i];
  if (typeof arg === "string" && arg.startsWith("--files-from=")) {
    const filePath = arg.slice("--files-from=".length);
    try {
      const data = JSON.parse(readFileSync(filePath, "utf8"));
      filesFromSet = new Set(Object.keys(data));
    } catch (err) {
      console.error(`Failed to read --files-from file ${filePath}: ${err.message}`);
      process.exit(1);
    }
    args.splice(i, 1);
  }
}

// --shard and --list are consumed here for the same reason --exclude is: any
// unrecognized token left in `args` gets forwarded to `node --test` verbatim.

let shard = null;
try {
  shard = parseShardArgs(args);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const listIdx = args.findIndex((a) => a === "--list");
const listOnly = listIdx !== -1;
if (listOnly) args.splice(listIdx, 1);

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

// Sort + exclude first, apply files-from filter, then stripe, so every shard
// partitions the same post-exclude and post-filter list. The empty-list hard-fail
// stays after striping and names which stage produced the empty set.

let files = [...topLevel, ...subdirs].sort().filter((f) => !isExcluded(f));
if (filesFromSet) files = files.filter((f) => filesFromSet.has(f));
const preShardCount = files.length;
if (shard) files = stripeFiles(files, shard.index, shard.total);

if (files.length === 0) {
  if (shard && preShardCount > 0) {
    console.error(`Shard ${shard.index}/${shard.total} selected 0 of ${preShardCount} test files — lower the shard total.`);
  } else {
    console.error(`No test files found in ${testsDir}`);
  }
  process.exit(1);
}

if (listOnly) {
  for (const f of files) console.log(f.split(path.sep).join("/"));
  process.exit(0);
}

// Per-batch timeouts: functional and deadcode audit suites exceed the 30s
// default on CI runners; timeoutForBatch raises limits only for batches that
// include those files so unit tests keep a tight ceiling.

const sterileBefore = snapshotRealConfigs();

// One node --test process per bounded batch keeps peak memory flat regardless of
// suite size. Batches run sequentially and every batch runs even after an earlier
// one fails, so the full pass/fail signal matches the old single-process run; the
// aggregate status is the first non-zero child status. Coverage keeps its single
// process so its one report is complete.

const BATCH_SIZE = Number(process.env.CONSTRUCT_TEST_BATCH_SIZE) || 120;

function timeoutForBatch(batchFiles) {
  if (batchFiles.some((f) => /tests\/graph\/incremental\.test\.mjs/.test(f))) {
    return 300_000;
  }
  if (batchFiles.some((f) => /tests\/functional\//.test(f) || /lazy-import-reachability/.test(f) || /oracle-approval-dedupe/.test(f))) {
    return 120_000;
  }
  if (batchFiles.some((f) => /(dashboard-build|llm\/|llm\\)/.test(f))) {
    return 180_000;
  }
  return 30_000;
}

function runFiles(batchFiles) {
  const batchNodeArgs = ["--test", `--test-timeout=${timeoutForBatch(batchFiles)}`];
  if (enableCoverage) {
    batchNodeArgs.push("--experimental-test-coverage");
  }
  return spawnSync(process.execPath, [...batchNodeArgs, ...batchFiles, ...args], { stdio: "inherit" }).status ?? 1;
}

let runStatus = 0;
if (enableCoverage) {
  runStatus = runFiles(files);
} else {
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const status = runFiles(files.slice(i, i + BATCH_SIZE));
    if (status !== 0 && runStatus === 0) runStatus = status;
  }
}

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
const sterileLeakCount =
  drift.auditTrailLeaks + drift.hookScratchLeaks + drift.telemetryLeaks + drift.sessionStatusLeaks;
if (drift.drifted.length || sterileLeakCount > 0) {
  const detail = [
    drift.drifted.length ? `Sterile drift — real host config changed: ${drift.drifted.join(", ")}` : null,
    drift.addedProjectKeys.length ? `  project keys added:   ${drift.addedProjectKeys.join(", ")}` : null,
    drift.removedProjectKeys.length ? `  project keys removed: ${drift.removedProjectKeys.join(", ")}` : null,
    drift.auditTrailLeaks > 0 ? `Sterile drift — ${drift.auditTrailLeaks} test-tagged record(s) appended to the real audit trail (a Broker was constructed without pinning the doctor root or injecting auditRecorder)` : null,
    drift.hookScratchLeaks > 0 ? `Sterile drift — ${drift.hookScratchLeaks} hook scratch marker(s) leaked into real doctorRoot state` : null,
    drift.telemetryLeaks > 0 ? `Sterile drift — ${drift.telemetryLeaks} test-tagged telemetry record(s) appended to real doctorRoot logs` : null,
    drift.sessionStatusLeaks > 0 ? `Sterile drift — ${drift.sessionStatusLeaks} test-tagged session/status marker(s) leaked into real doctorRoot state` : null,
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

process.exit(runStatus);
