/**
 * tests/helpers/sterile-host-env.test.mjs — Validate the sterile host sandbox.
 *
 * Proves the sandbox exercises the real provisioning + config-write logic against
 * a stubbed Ollama and an isolated HOME, while the machine's real configs and
 * model store stay byte-identical. Guards against the failure mode this harness
 * exists to prevent: a test leaking writes into the user's actual tool configs.
 */
import test from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHostSandbox, fingerprintRealConfigs, assertRealConfigsUnchanged, snapshotRealConfigs, diffRealConfigs } from "./sterile-host-env.mjs";
import { rmTmpDir } from "./cleanup.mjs";
import { doctorRoot } from "../../lib/config/xdg.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

test("provisioning runs against the stub, real Ollama + configs untouched", () => {
  const before = fingerprintRealConfigs();
  const sandbox = createHostSandbox({
    ollamaModels: [
      { name: "qwen2.5-coder:7b", params: "7.6B", trainedCtx: 32768, tools: true, numCtx: null },
      { name: "deepseek-coder-v2:16b", params: "16B", trainedCtx: 16384, tools: false, numCtx: null },
    ],
  });

  try {
    // Exercise the real provisioner via the sandboxed PATH (stub ollama).
    const r = spawnSync(process.execPath, [join(repoRoot, "lib", "ollama", "provision-context.mjs"), "--num-ctx=32768"], {
      env: sandbox.env,
      encoding: "utf8",
    });
    assert.equal(r.status, 0, `provisioner exited non-zero: ${r.stderr}`);
    const out = JSON.parse(r.stdout);

    assert.equal(out.mapping["qwen2.5-coder:7b"], "qwen2.5-coder:7b-cx32k", "tool-capable model gets a variant");
    assert.equal(out.mapping["deepseek-coder-v2:16b"], undefined, "non-tool-capable model is skipped");

    // The variant landed in the SANDBOX ollama state, never the real store.
    const stubState = JSON.parse(readFileSync(sandbox.ollamaStateFile, "utf8"));
    assert.ok(stubState.models.some((m) => m.name === "qwen2.5-coder:7b-cx32k"), "variant recorded in sandbox state");

    // The load-bearing assertion: nothing outside the sandbox moved.
    assertRealConfigsUnchanged(before);
  } finally {
    sandbox.cleanup();
  }
});

test("a write into the real config path is detected as a sterile violation", () => {
  // The guard must actually catch drift — fabricate a changed fingerprint and
  // confirm it throws, so a real leak cannot pass silently.

  const before = fingerprintRealConfigs();
  const tampered = { ...before, "ollama:list": "deadbeefdeadbeef" };
  assert.throws(() => assertRealConfigsUnchanged(tampered), /Sterile violation/);
});

// A whole-file hash on the audit trail would flap on legitimate concurrent
// real-session writes (the same false-positive class the MCP-surface fix
// solved for ~/.claude.json), so the guard counts only test-tagged records
// instead — this must not fire on unrelated real appends, and must fire when
// a leaked test record lands.

test("real audit-trail appends unrelated to tests are not reported as a leak", () => {
  const home = mkdtempSync(join(tmpdir(), "sterile-audit-home-"));
  try {
    const stateDir = doctorRoot(home);
    mkdirSync(stateDir, { recursive: true });
    const auditPath = join(stateDir, "audit-trail.jsonl");
    writeFileSync(auditPath, "");

    const before = snapshotRealConfigs(home);
    appendFileSync(auditPath, JSON.stringify({ agent: "mcp-broker", source: "policy-engine", outcome: "allowed" }) + "\n");
    const drift = diffRealConfigs(before, home);

    assert.equal(drift.auditTrailLeaks, 0, "a real (non-test-tagged) append must not count as a leak");
  } finally {
    rmTmpDir(home);
  }
});

test("a test-tagged record appended to the real audit trail is detected as a leak", () => {
  const home = mkdtempSync(join(tmpdir(), "sterile-audit-home-"));
  try {
    const stateDir = doctorRoot(home);
    mkdirSync(stateDir, { recursive: true });
    const auditPath = join(stateDir, "audit-trail.jsonl");
    writeFileSync(auditPath, "");

    const before = snapshotRealConfigs(home);
    appendFileSync(auditPath, JSON.stringify({ agent: "mcp-broker", source: "test", outcome: "allowed" }) + "\n");
    appendFileSync(auditPath, JSON.stringify({ agent: "mcp-broker", source: "test", outcome: "denied" }) + "\n");
    const drift = diffRealConfigs(before, home);

    assert.equal(drift.auditTrailLeaks, 2, "both test-tagged appends must be counted as leaks");
  } finally {
    rmTmpDir(home);
  }
});

// ~/.claude.json mixes Claude Code's own volatile runtime state (pluginUsage
// counters, growthbook cache stamps, per-project history) with the one surface
// Construct manages there: MCP server definitions. A live Claude session
// rewriting its telemetry mid-suite must not read as a test leak, while any
// change to user- or project-scope mcpServers still must.

function fixtureHome(claudeJson) {
  const home = mkdtempSync(join(tmpdir(), "cx-sterile-fp-"));
  writeFileSync(join(home, ".claude.json"), JSON.stringify(claudeJson, null, 2));
  return home;
}

const BASE_CLAUDE_JSON = {
  mcpServers: { "construct-memory": { command: "node", args: ["bridge.mjs"] } },
  projects: {
    "/Users/someone/project": {
      mcpServers: { "local-server": { command: "node" } },
      history: [{ display: "old prompt" }],
    },
  },
  pluginUsage: { "superpowers@official": { usageCount: 1, lastUsedAt: 1 } },
  cachedGrowthBookFeaturesAt: 1,
};

test("Claude Code runtime telemetry churn in ~/.claude.json is not sterile drift", () => {
  const home = fixtureHome(BASE_CLAUDE_JSON);
  try {
    const before = fingerprintRealConfigs(home);
    writeFileSync(join(home, ".claude.json"), JSON.stringify({
      ...BASE_CLAUDE_JSON,
      pluginUsage: { "superpowers@official": { usageCount: 2, lastUsedAt: 2 } },
      cachedGrowthBookFeaturesAt: 2,
      projects: {
        "/Users/someone/project": {
          ...BASE_CLAUDE_JSON.projects["/Users/someone/project"],
          history: [{ display: "new prompt" }],
        },
      },
    }, null, 2));
    assertRealConfigsUnchanged(before, home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a change to user-scope mcpServers in ~/.claude.json is sterile drift", () => {
  const home = fixtureHome(BASE_CLAUDE_JSON);
  try {
    const before = fingerprintRealConfigs(home);
    writeFileSync(join(home, ".claude.json"), JSON.stringify({
      ...BASE_CLAUDE_JSON,
      mcpServers: { ...BASE_CLAUDE_JSON.mcpServers, leaked: { command: "leak" } },
    }, null, 2));
    assert.throws(() => assertRealConfigsUnchanged(before, home), /\.claude\.json/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a change to a project-scope mcpServers entry in ~/.claude.json is sterile drift", () => {
  const home = fixtureHome(BASE_CLAUDE_JSON);
  try {
    const before = fingerprintRealConfigs(home);
    writeFileSync(join(home, ".claude.json"), JSON.stringify({
      ...BASE_CLAUDE_JSON,
      projects: {
        "/Users/someone/project": {
          ...BASE_CLAUDE_JSON.projects["/Users/someone/project"],
          mcpServers: { "local-server": { command: "node" }, leaked: { command: "leak" } },
        },
      },
    }, null, 2));
    assert.throws(() => assertRealConfigsUnchanged(before, home), /\.claude\.json/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("an unparseable ~/.claude.json still trips the guard on content change", () => {
  const home = fixtureHome(BASE_CLAUDE_JSON);
  try {
    writeFileSync(join(home, ".claude.json"), "{ not json");
    const before = fingerprintRealConfigs(home);
    writeFileSync(join(home, ".claude.json"), "{ still not json, but different");
    assert.throws(() => assertRealConfigsUnchanged(before, home), /\.claude\.json/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ADR-0084: approvals/queue.jsonl is the bead's named priority target — the audit's
// truth-matrix (row 42) names it as the one real-state-file class with a claimed
// historical contamination incident. Like audit-trail.jsonl, it is append-only real
// session state, so a whole-content hash would flap on legitimate concurrent approval
// activity; the guard instead counts records tagged via ApprovalQueue's one caller-
// controlled passthrough field, requestedBy.role, exactly as countAuditTrailTestLeaks
// counts audit-trail's `"source":"test"` records.

test("real approval-queue records unrelated to tests are not reported as a leak", () => {
  const home = mkdtempSync(join(tmpdir(), "sterile-approvals-home-"));
  try {
    const stateDir = doctorRoot(home);
    const approvalsDir = join(stateDir, "approvals");
    mkdirSync(approvalsDir, { recursive: true });
    const queuePath = join(approvalsDir, "queue.jsonl");
    writeFileSync(queuePath, "");

    const before = snapshotRealConfigs(home);
    appendFileSync(queuePath, JSON.stringify({
      approvalId: "appr-real-1",
      toolCall: { tool: "github.pr.merge", args: { number: 42 }, surface: "mcp", argsHash: "deadbeef" },
      requestedBy: { userId: null, serviceId: null, tenantId: null, sessionId: null, role: "engineer" },
      state: "awaiting_approval",
    }) + "\n");
    const drift = diffRealConfigs(before, home);

    assert.equal(drift.approvalQueueLeaks, 0, "a real (non-test-tagged) approval record must not count as a leak");
  } finally {
    rmTmpDir(home);
  }
});

test("a test-tagged record appended to the real approval queue is detected as a leak", () => {
  const home = mkdtempSync(join(tmpdir(), "sterile-approvals-home-"));
  try {
    const stateDir = doctorRoot(home);
    const approvalsDir = join(stateDir, "approvals");
    mkdirSync(approvalsDir, { recursive: true });
    const queuePath = join(approvalsDir, "queue.jsonl");
    writeFileSync(queuePath, "");

    const before = snapshotRealConfigs(home);
    // Same shape ApprovalQueue.enqueue() persists (lib/embed/approval-queue.mjs:83-100):
    // requestedBy.role is the one caller-controlled field that survives the whitelist.
    appendFileSync(queuePath, JSON.stringify({
      approvalId: "appr-test-1",
      toolCall: { tool: "test", args: {}, surface: "mcp", argsHash: "deadbeef" },
      requestedBy: { userId: null, serviceId: null, tenantId: null, sessionId: null, role: "__sterile_test__" },
      state: "awaiting_approval",
    }) + "\n");
    appendFileSync(queuePath, JSON.stringify({
      approvalId: "appr-test-2",
      toolCall: { tool: "test", args: {}, surface: "mcp", argsHash: "beadfeed" },
      requestedBy: { userId: null, serviceId: null, tenantId: null, sessionId: null, role: "__sterile_test__" },
      state: "awaiting_approval",
    }) + "\n");
    const drift = diffRealConfigs(before, home);

    assert.equal(drift.approvalQueueLeaks, 2, "both test-tagged approval records must be counted as leaks");
  } finally {
    rmTmpDir(home);
  }
});

// The dir-entry-set classes (sandboxes, performance-reviews, scheduler/logs, runtime,
// runtime/oracle — ADR-0084) generalize realConstructProjectKeys()'s pattern: a file
// appearing under a real doctorRoot()-scoped directory a hermetically-isolated test
// should never touch must show up as fingerprint drift on that class's own key, without
// requiring a content-level test marker.

test("a new file under a doctorRoot() dir-entry class is reported as fingerprint drift", () => {
  const home = mkdtempSync(join(tmpdir(), "sterile-sandboxes-home-"));
  try {
    const sandboxesDir = join(doctorRoot(home), "sandboxes");
    mkdirSync(sandboxesDir, { recursive: true });

    const before = fingerprintRealConfigs(home);
    mkdirSync(join(sandboxesDir, "leaked-sandbox-id"), { recursive: true });
    const after = fingerprintRealConfigs(home);

    assert.notEqual(before["doctorRoot:sandboxes"], after["doctorRoot:sandboxes"], "a new sandbox dir entry must change the fingerprint");
  } finally {
    rmTmpDir(home);
  }
});
