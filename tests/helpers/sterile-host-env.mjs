/**
 * tests/helpers/sterile-host-env.mjs — Lightweight sterile sandbox for host-config tests.
 *
 * Construct sync, OpenCode config writes, and Ollama model provisioning mutate real
 * user state (`~/.config/opencode/opencode.json`, the Ollama model store), so a test
 * that exercises them must not reach the real machine. This sandbox redirects every
 * host path into a temp root via HOME + the XDG base-dir variables + `OLLAMA_MODELS`,
 * and replaces external CLIs (`ollama`, optionally `opencode`) with deterministic
 * stubs on a sandboxed PATH so a test never reaches the real daemon. A real-config
 * fingerprint guard (`assertRealConfigsUnchanged`) fails the test if anything outside
 * the sandbox moves.
 *
 * Pattern: hermetic env isolation (XDG base-dir spec) + CLI stubbing + a footprint
 * diff — the standard lightweight alternative to a full VM/container for config tests.
 *
 * ADR-0066 moved heavy per-project state (traces, observations, the vector index,
 * runtime bootstrap dirs) out of a project's `.cx/` and into `~/.construct/projects/<key>/`
 * — a real host path most tests never touch on purpose. A test that spins up a project
 * in a tmp dir but forgets to override HOME now has a second way to leak into the real
 * machine, so the fingerprint also covers the real `~/.construct/projects/` entry set.
 *
 * ADR-0084 found that `doctorRoot()` (`lib/config/xdg.mjs:55`) — the resolution point
 * for nearly a hundred production call sites under `~/.local/state/construct/` — was
 * fingerprinted for exactly one of its real-state-file classes (the audit trail). Every
 * other class (approval queues, Oracle state, embed-daemon runtime state, doctor watcher
 * state, cost/model tracking, sandboxes, performance reviews, scheduler logs, contract
 * violations) was invisible to this guard, so a test that failed to isolate `HOME`/XDG
 * could write into any of them undetected. The extension below widens coverage to those
 * classes, generalizing the two strategies this file already established: a test-tagged
 * record count for append-only logs a real session writes to continuously (matching
 * `countAuditTrailTestLeaks`), and a content or directory-entry-set hash for state that
 * is otherwise stable between test-triggered writes (matching `hashPath` and
 * `realConstructProjectKeys`). `approvals/queue.jsonl` is the bead's named priority
 * target — the audit's truth-matrix (row 42) names it as the one real-state-file class
 * with a claimed historical contamination incident.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync, chmodSync } from "node:fs";
import { rmTmpDir } from "./cleanup.mjs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { doctorRoot } from "../../lib/config/xdg.mjs";

// Real host paths a host-config test must never mutate. The guard fingerprints
// these before and after; any change fails the test loudly.

export function realProtectedPaths(home = homedir()) {
  return [
    join(home, ".config", "opencode", "opencode.json"),
    join(home, ".claude", "settings.json"),
    // Claude Code's user-scope MCP servers live here, not in settings.json
    // (construct-ranh) — guard it too so a sandbox leak into the real ~/.claude.json
    // is caught. This file also carries Claude Code runtime state that any live
    // Claude session rewrites, so it is fingerprinted by its MCP surface only
    // (hashClaudeUserMcpSurface), not by content hash.
    join(home, ".claude.json"),
    join(home, ".codex", "config.toml"),
  ];
}

// Directory, not a single file — fingerprint the sorted entry list rather than
// a content hash so a run that creates or removes a project key is caught even
// though nothing under realProtectedPaths() changed.

function realConstructProjectKeys(home) {
  const dir = join(home, ".construct", "projects");
  try {
    return existsSync(dir) ? readdirSync(dir).sort().join(",") : "absent";
  } catch {
    return "unreadable";
  }
}

// Generalizes realConstructProjectKeys() above to any doctorRoot()-scoped directory:
// a leaking test typically creates a new file/dir under a real state root rather than
// mutating an existing one's bytes, so the sorted entry list is the stable "unchanged"
// signal — content within an existing entry (e.g. a rewritten heartbeat.json) is allowed
// to churn from legitimate real activity without flapping the guard.

function dirEntryKeys(dir) {
  try {
    return existsSync(dir) ? readdirSync(dir).sort().join(",") : "absent";
  } catch {
    return "unreadable";
  }
}

// Directory-shaped real-state-file classes from ADR-0084's Context table, each a real
// doctorRoot()-resolved production path with low enough real-world write frequency
// (CLI-triggered, Stop-hook-triggered once per session, or OS-scheduler-triggered) that
// an entry-set hash won't flap on legitimate background activity the way a raw content
// hash of a continuously-appended file would:
//   sandboxes            — lib/sandbox.mjs:27 (construct sandbox CLI; developer-triggered)
//   performance-reviews  — lib/hooks/session-optimize.mjs:30, lib/performance/generate.mjs:31,
//                           lib/mcp/tools/project.mjs:69 (Stop hook, once per session end)
//   scheduler/logs       — lib/scheduler/solo.mjs:87,89,125-126 (OS launchd/systemd stdout/
//                           stderr redirect targets; only move if a scheduled job fires)
//   runtime               — lib/embed/daemon.mjs:134,669, lib/embed/supervision.mjs:243
//                           (embed-daemon runtime state: embed-daemon.json, embed-daemon.log,
//                           per-service logs)
//   runtime/oracle        — lib/oracle/index.mjs:21 (Oracle runtime state)

function realDoctorRootDirClasses(home) {
  const root = doctorRoot(home);
  return {
    sandboxes: join(root, "sandboxes"),
    "performance-reviews": join(root, "performance-reviews"),
    "scheduler:logs": join(root, "scheduler", "logs"),
    runtime: join(root, "runtime"),
    "runtime:oracle": join(root, "runtime", "oracle"),
  };
}

// Small, mostly-static single-file real-state classes from ADR-0084's Context table.
// Each resolves under doctorRoot() and is overwritten wholesale rather than appended, at
// a real-world write frequency low enough (CLI-triggered budget/pricing lookups, or a
// `construct doctor --watch` watcher tick that only runs when explicitly started) that a
// whole-content hash — matching hashPath's existing pattern — won't flap on legitimate
// background activity during a hermetic test run:
//   cost-ledger.json           — lib/cost-ledger.mjs:30
//   model-pricing.json         — lib/model-pricing.mjs:23 (5-minute OpenRouter cache)
//   pricing-cache.json         — lib/telemetry/model-pricing-catalog.mjs:25
//   cost-watcher-state.json    — lib/doctor/watchers/cost.mjs:30 (only moves under an
//                                 actively running `construct doctor --watch`)
//   bd-watch-seen.json         — lib/doctor/watchers/bd-watch.mjs:28 (same)
//   contract-violations.jsonl  — lib/contracts/violation-log.mjs:34; this is the
//                                 doctorRoot() *fallback* copy only — resolveProjectScopedPath
//                                 (lib/project-root.mjs:94-99) routes real project-scoped
//                                 invocations to <project>/.construct/ instead, so this path
//                                 only moves for standalone (no `.construct/` marker) runs

function realDoctorRootHashPaths(home) {
  const root = doctorRoot(home);
  return {
    "cost-ledger.json": join(root, "cost-ledger.json"),
    "model-pricing.json": join(root, "model-pricing.json"),
    "pricing-cache.json": join(root, "pricing-cache.json"),
    "cost-watcher-state.json": join(root, "cost-watcher-state.json"),
    "bd-watch-seen.json": join(root, "bd-watch-seen.json"),
    "contract-violations.jsonl": join(root, "contract-violations.jsonl"),
  };
}

// The audit trail is an append-only log real sessions write to continuously
// (construct-mtgs's own dogfood usage adds thousands of lines/day), so a
// content-hash "unchanged" fingerprint would flap on legitimate concurrent
// writes — the same false-positive class the MCP-surface fix solved for
// ~/.claude.json. Instead, count only records tagged `"source":"test"`, the
// literal every test-fixture policy decision in tests/mcp-broker*.test.mjs
// uses and no real policy engine ever emits; a leak shows up as a delta,
// legitimate real usage never moves this count.

function countAuditTrailTestLeaks(home) {
  const file = doctorRoot(home);
  const auditPath = join(file, "audit-trail.jsonl");
  try {
    if (!existsSync(auditPath)) return 0;
    const contents = readFileSync(auditPath, "utf8");
    let count = 0;
    for (const line of contents.split("\n")) {
      if (line.includes('"source":"test"')) count++;
    }
    return count;
  } catch {
    return 0;
  }
}

// approvals/queue.jsonl (ApprovalQueue.resolvePersistPath, lib/embed/approval-queue.mjs:271)
// is append-only real session state shaped like audit-trail.jsonl, and the audit's
// truth-matrix (row 42) names it as the one real-state-file class with a claimed
// historical contamination incident — the bead's named priority target. ApprovalQueue's
// enqueue() (lib/embed/approval-queue.mjs:83-100) does not pass caller fields through
// generically: requestedBy is rebuilt field-by-field from a fixed whitelist
// (userId/serviceId/tenantId/sessionId/role), so — unlike audit-trail's freeform
// `source` — a leak proof has exactly one passthrough field it can tag. This mirrors
// countAuditTrailTestLeaks's marker-count pattern using requestedBy.role as the carrier.

const APPROVAL_QUEUE_TEST_MARKER = '"role":"__sterile_test__"';

function countApprovalQueueTestLeaks(home) {
  const file = join(doctorRoot(home), "approvals", "queue.jsonl");
  try {
    if (!existsSync(file)) return 0;
    const contents = readFileSync(file, "utf8");
    let count = 0;
    for (const line of contents.split("\n")) {
      if (line.includes(APPROVAL_QUEUE_TEST_MARKER)) count++;
    }
    return count;
  } catch {
    return 0;
  }
}

function hashPath(p) {
  try {
    return existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16) : "absent";
  } catch {
    return "unreadable";
  }
}

// ~/.claude.json interleaves Claude Code's volatile runtime state (pluginUsage
// counters, growthbook cache stamps, per-project history — rewritten by any live
// Claude session, including the one a developer is running the suite from) with
// the one surface Construct manages there: MCP server definitions. Hashing the
// whole file makes the guard flap on ambient telemetry writes, so fingerprint
// only the MCP surface — top-level `mcpServers` plus each project's `mcpServers`
// — canonicalized by key order. Same volatility trim as the `ollama list`
// fingerprint above. An unparseable file falls back to the content hash so a
// test that corrupts it is still caught.

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonicalize(value[k])]));
  }
  return value;
}

function hashClaudeUserMcpSurface(p) {
  if (!existsSync(p)) return "absent";
  let config;
  try {
    config = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return hashPath(p);
  }
  const surface = {
    mcpServers: config?.mcpServers ?? {},
    projects: Object.fromEntries(
      Object.entries(config?.projects ?? {})
        .filter(([, v]) => v?.mcpServers && Object.keys(v.mcpServers).length)
        .map(([k, v]) => [k, v.mcpServers]),
    ),
  };
  return createHash("sha256").update(JSON.stringify(canonicalize(surface))).digest("hex").slice(0, 16);
}

// Fingerprint the durable model identity (sorted names) only — `ollama list`'s
// SIZE/MODIFIED columns are volatile (relative timestamps) and would make the guard
// flap. Model set membership is what "real store unchanged" actually means.

function realOllamaList() {
  try {
    const raw = execFileSync("ollama", ["list"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 });
    return raw.trim().split("\n").slice(1)
      .map((line) => line.split(/\s+/)[0])
      .filter(Boolean)
      .sort()
      .join(",");
  } catch {
    return "ollama-unavailable";
  }
}

export function fingerprintRealConfigs(home = homedir()) {
  const fp = {};
  const claudeUserConfigPath = join(home, ".claude.json");
  for (const p of realProtectedPaths(home)) {
    fp[p] = p === claudeUserConfigPath ? hashClaudeUserMcpSurface(p) : hashPath(p);
  }
  fp["ollama:list"] = createHash("sha256").update(realOllamaList()).digest("hex").slice(0, 16);
  fp["construct:projects"] = createHash("sha256").update(realConstructProjectKeys(home)).digest("hex").slice(0, 16);

  for (const [key, dir] of Object.entries(realDoctorRootDirClasses(home))) {
    fp[`doctorRoot:${key}`] = createHash("sha256").update(dirEntryKeys(dir)).digest("hex").slice(0, 16);
  }
  for (const [key, p] of Object.entries(realDoctorRootHashPaths(home))) {
    fp[`doctorRoot:${key}`] = hashPath(p);
  }

  return fp;
}

// Snapshot + diff variants for the whole-suite guard in scripts/run-tests.mjs:
// beyond the pass/fail hash, they carry the raw project-key entry list so a
// drift report can name exactly which keys appeared or vanished — the
// attribution signal the per-test isolation work (construct-mtgs) needs to
// find the leaking test, instead of an opaque "something changed".

export function snapshotRealConfigs(home = homedir()) {
  return {
    fingerprint: fingerprintRealConfigs(home),
    projectKeys: realConstructProjectKeys(home).split(",").filter(Boolean),
    auditTrailTestLeaks: countAuditTrailTestLeaks(home),
    approvalQueueTestLeaks: countApprovalQueueTestLeaks(home),
  };
}

export function diffRealConfigs(beforeSnapshot, home = homedir()) {
  const after = snapshotRealConfigs(home);
  const drifted = Object.keys(beforeSnapshot.fingerprint).filter(
    (k) => beforeSnapshot.fingerprint[k] !== after.fingerprint[k],
  );
  const beforeKeys = new Set(beforeSnapshot.projectKeys);
  const afterKeys = new Set(after.projectKeys);
  return {
    drifted,
    addedProjectKeys: [...afterKeys].filter((k) => !beforeKeys.has(k)),
    removedProjectKeys: [...beforeKeys].filter((k) => !afterKeys.has(k)),
    auditTrailLeaks: after.auditTrailTestLeaks - (beforeSnapshot.auditTrailTestLeaks ?? 0),
    approvalQueueLeaks: after.approvalQueueTestLeaks - (beforeSnapshot.approvalQueueTestLeaks ?? 0),
  };
}

// A node-based `ollama` stub that emits the exact text shapes provision-context
// parses (list table, `show` Model/Capabilities/Parameters blocks) and records
// `create` into a sandbox state file — so provisioning logic runs end to end
// without touching the real model store.

const OLLAMA_STUB = `#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const state = process.env.OLLAMA_STUB_STATE;
const load = () => JSON.parse(readFileSync(state, "utf8"));
const save = (d) => writeFileSync(state, JSON.stringify(d));
const args = process.argv.slice(2);
const cmd = args[0];
if (cmd === "--version") { process.stdout.write("ollama version is 0.0.0-stub\\n"); process.exit(0); }
const db = load();
if (cmd === "list") {
  process.stdout.write("NAME\\tID\\tSIZE\\tMODIFIED\\n");
  for (const m of db.models) process.stdout.write(\`\${m.name}\\tstub\\t1 GB\\t1 day ago\\n\`);
  process.exit(0);
}
if (cmd === "show") {
  const m = db.models.find((x) => x.name === args[1]);
  if (!m) { process.stderr.write("Error: model not found\\n"); process.exit(1); }
  let out = \`  Model\\n    parameters          \${m.params}\\n    context length      \${m.trainedCtx}\\n\\n  Capabilities\\n    completion\\n\`;
  if (m.tools) out += "    tools\\n";
  if (m.numCtx) out += \`\\n  Parameters\\n    num_ctx           \${m.numCtx}\\n\`;
  process.stdout.write(out);
  process.exit(0);
}
if (cmd === "create") {
  const name = args[1];
  const fileIdx = args.indexOf("-f");
  const mf = fileIdx >= 0 && existsSync(args[fileIdx + 1]) ? readFileSync(args[fileIdx + 1], "utf8") : "";
  const numCtx = Number((mf.match(/num_ctx\\s+(\\d+)/) || [])[1]) || null;
  db.models.push({ name, params: "7.6B", trainedCtx: 32768, tools: true, numCtx });
  save(db);
  process.stdout.write("success\\n");
  process.exit(0);
}
process.exit(0);
`;

/**
 * Create a sterile host sandbox. Returns { root, env, ollamaStateFile, cleanup }.
 * Pass the returned `env` to spawnSync/execFileSync so the child reads and writes
 * only inside the sandbox.
 */
export function createHostSandbox({ ollamaModels = [], stubOllama = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "cx-host-sandbox-"));
  const configHome = join(root, ".config");
  const dataHome = join(root, ".local", "share");
  const binDir = join(root, "bin");
  for (const d of [configHome, dataHome, join(root, ".cache"), join(root, ".local", "state"), binDir]) {
    mkdirSync(d, { recursive: true });
  }

  // A sandboxed HOME has an empty embedding-model cache (it lives under
  // ~/.construct/cache), so any code path that loads the Xenova model would
  // download ~90MB from HuggingFace mid-test — slow and a network dependency a
  // hermetic test must not have. CONSTRUCT_EMBEDDING_MODEL=hashing forces the
  // deterministic hashing backend, which never touches the model or the network
  // (the @huggingface/transformers JS lib does not honor TRANSFORMERS_OFFLINE).

  const env = {
    ...process.env,
    HOME: root,
    XDG_CONFIG_HOME: configHome,
    XDG_DATA_HOME: dataHome,
    XDG_CACHE_HOME: join(root, ".cache"),
    XDG_STATE_HOME: join(root, ".local", "state"),
    OLLAMA_MODELS: join(root, "ollama-models"),
    CONSTRUCT_EMBEDDING_MODEL: "hashing",
    CONSTRUCT_EMBEDDING_DISABLE_LOCAL: "1",
  };

  let ollamaStateFile = null;
  if (stubOllama) {
    const stubPath = join(binDir, "ollama");
    writeFileSync(stubPath, OLLAMA_STUB);
    chmodSync(stubPath, 0o755);
    ollamaStateFile = join(root, "ollama-state.json");
    writeFileSync(ollamaStateFile, JSON.stringify({ models: ollamaModels }));
    env.OLLAMA_STUB_STATE = ollamaStateFile;
    env.PATH = `${binDir}:${process.env.PATH}`;
  }

  return {
    root,
    env,
    ollamaStateFile,
    cleanup: () => { try { rmTmpDir(root); } catch { /* ok */ } },
  };
}

/**
 * Assert the real host configs match a fingerprint taken before the test. Throws
 * with the specific drifted path if a test leaked a write outside the sandbox.
 */
export function assertRealConfigsUnchanged(before, home = homedir()) {
  const after = fingerprintRealConfigs(home);
  const drifted = Object.keys(before).filter((k) => before[k] !== after[k]);
  if (drifted.length) {
    throw new Error(`Sterile violation — real host config changed: ${drifted.join(", ")}`);
  }
  return true;
}
