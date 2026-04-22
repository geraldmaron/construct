/**
 * tests/concierge-routing.test.mjs — Concierge routing regression harness.
 *
 * Each test represents a real request a user might send Construct. They verify:
 * 1. The done-gate rejects implementation tasks without review evidence
 * 2. The done-gate passes when verification is present
 * 3. Internal agents are not exposed in user-facing listings
 * 4. Dispatch plan field is preserved through workflow state
 *
 * For prompt-level routing (which track Construct picks), these tests act as
 * a documentation contract — the expected routing is asserted in comments so
 * future prompt changes can be validated against them manually or via evals.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultWorkflow,
  addTask,
  updateTask,
  loadWorkflow,
  saveWorkflow,
  alignmentFindings,
} from "../lib/workflow-state.mjs";
import { routeRequest } from "../lib/orchestration-policy.mjs";

// ── Helpers ──────────────────────────────────────────────────────────────────

function tmpRoot() {
  const dir = mkdtempSync(join(tmpdir(), "cx-routing-"));
  mkdirSync(join(dir, ".cx"), { recursive: true });
  return dir;
}

function withWorkflow(root, patch = {}) {
  const wf = { ...defaultWorkflow(root, "test"), ...patch };
  saveWorkflow(wf, root);
  return wf;
}

// ── Done-gate: implement-phase tasks require verification ────────────────────

describe("done-gate: implement-phase tasks", () => {
  let root;
  beforeEach(() => { root = tmpRoot(); });

  it("blocks marking implement task done without verification", () => {
    withWorkflow(root);
    addTask(root, {
      title: "Build auth flow",
      phase: "implement",
      owner: "cx-engineer",
      acceptanceCriteria: ["login works"],
    });
    const wf = loadWorkflow(root);
    const key = wf.tasks[0].key;

    assert.throws(
      () => updateTask(root, key, { status: "done" }),
      /Cannot mark implement-phase task.*without verification evidence/
    );
  });

  it("allows marking implement task done when verification is provided inline", () => {
    withWorkflow(root);
    addTask(root, {
      title: "Build auth flow",
      phase: "implement",
      owner: "cx-engineer",
      acceptanceCriteria: ["login works"],
    });
    const wf = loadWorkflow(root);
    const key = wf.tasks[0].key;

    assert.doesNotThrow(() =>
      updateTask(root, key, {
        status: "done",
        verification: ["cx-reviewer: APPROVED — no CRITICAL or HIGH findings", "cx-qa: 42 tests passing"],
      })
    );

    const updated = loadWorkflow(root);
    assert.equal(updated.tasks[0].status, "done");
  });

  it("allows marking implement task done when verification was set previously", () => {
    withWorkflow(root);
    addTask(root, { title: "Fix bug", phase: "implement", owner: "cx-engineer", acceptanceCriteria: ["bug gone"] });
    const wf = loadWorkflow(root);
    const key = wf.tasks[0].key;

    updateTask(root, key, { verification: ["cx-reviewer: APPROVED"] });
    assert.doesNotThrow(() => updateTask(root, key, { status: "done" }));
  });

  it("does not apply gate to non-implement phases", () => {
    withWorkflow(root);
    addTask(root, { title: "Research options", phase: "research", owner: "cx-explorer", acceptanceCriteria: ["evidence gathered"] });
    const wf = loadWorkflow(root);
    const key = wf.tasks[0].key;

    // research tasks can be marked done without verification — no review needed
    assert.doesNotThrow(() => updateTask(root, key, { status: "done" }));
  });

  it("gate is bypassed when verificationRequiredBeforeDone is false", () => {
    const base = defaultWorkflow(root, "test");
    base.alignment.verificationRequiredBeforeDone = false;
    saveWorkflow(base, root);
    addTask(root, { title: "Quick fix", phase: "implement", owner: "cx-engineer", acceptanceCriteria: ["fixed"] });
    const wf = loadWorkflow(root);
    const key = wf.tasks[0].key;

    assert.doesNotThrow(() => updateTask(root, key, { status: "done" }));
  });
});

// ── Alignment: done tasks without verification surface as HIGH findings ───────

describe("alignment findings: verification evidence", () => {
  let root;
  beforeEach(() => { root = tmpRoot(); });

  it("done implement task with verification has no HIGH finding", () => {
    withWorkflow(root);
    addTask(root, { title: "Ship feature", phase: "implement", owner: "cx-engineer", acceptanceCriteria: ["works"] });
    const wf = loadWorkflow(root);
    const key = wf.tasks[0].key;

    updateTask(root, key, {
      status: "done",
      verification: ["cx-reviewer: APPROVED", "cx-qa: PASS — 80% coverage"],
    });

    const updated = loadWorkflow(root);
    const findings = alignmentFindings(updated);
    const verificationFindings = findings.filter((f) => f.issue?.includes("verification"));
    assert.equal(verificationFindings.length, 0);
  });
});

// ── Dispatch plan is persisted and visible ────────────────────────────────────

describe("dispatch plan persistence", () => {
  let root;
  beforeEach(() => { root = tmpRoot(); });

  it("dispatchPlan field round-trips through workflow state", () => {
    const wf = defaultWorkflow(root, "auth feature");
    wf.dispatchPlan = "Plan: cx-architect → cx-engineer → cx-reviewer + cx-qa";
    saveWorkflow(wf, root);

    const loaded = loadWorkflow(root);
    assert.equal(loaded.dispatchPlan, "Plan: cx-architect → cx-engineer → cx-reviewer + cx-qa");
  });
});

// ── Internal agent isolation ──────────────────────────────────────────────────

describe("registry: internal agent isolation", () => {
  it("all agents in registry have internal:true", async () => {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const registry = require("../agents/registry.json");

    const exposed = registry.agents.filter((a) => !a.internal);
    assert.deepEqual(
      exposed,
      [],
      `These agents are not marked internal and will be visible in user-facing adapters: ${exposed.map((a) => a.name).join(", ")}`
    );
  });

  it("only construct persona exists and is not internal", async () => {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const registry = require("../agents/registry.json");

    assert.equal(registry.personas.length, 1, "Expected exactly one persona (construct)");
    assert.equal(registry.personas[0].name, "construct");
    assert.equal(registry.personas[0].internal, undefined, "Construct persona must not be marked internal");
  });
});

// ── Routing contract: expected specialist per request type (documentation) ───
// These describe the expected Construct routing for real request types.

describe("routing contract: expected dispatch per request type", () => {
  const routingTable = [
    { request: "build this feature end to end", fileCount: 4, moduleCount: 2, track: "orchestrated", specialists: ["cx-architect", "cx-engineer", "cx-reviewer", "cx-qa"] },
    { request: "fix this bug", fileCount: 2, moduleCount: 1, track: "focused", specialists: ["cx-debugger", "cx-engineer"] },
    { request: "review my changes", fileCount: 2, moduleCount: 1, track: "focused", specialists: ["cx-reviewer"] },
    { request: "scan for security issues", fileCount: 2, moduleCount: 1, track: "orchestrated", specialists: ["cx-architect", "cx-engineer", "cx-reviewer", "cx-qa", "cx-security"] },
    { request: "what does this function do", fileCount: 1, moduleCount: 1, track: "immediate", specialists: [] },
    { request: "explore the auth module", fileCount: 1, moduleCount: 1, track: "immediate", specialists: [] },
    { request: "design the onboarding UI", fileCount: 2, moduleCount: 1, track: "focused", specialists: ["cx-designer"] },
    { request: "write requirements for checkout", fileCount: 2, moduleCount: 1, track: "focused", specialists: ["cx-product-manager"] },
    { request: "write a platform PRD for API migration controls", fileCount: 2, moduleCount: 1, track: "orchestrated", specialists: ["cx-product-manager"], productFlavor: "platform" },
    { request: "write a Meta PRD for the agent evaluation loop", fileCount: 2, moduleCount: 1, track: "orchestrated", specialists: ["cx-product-manager"], productFlavor: "ai-product" },
    { request: "create a backlog proposal from these customer notes", fileCount: 2, moduleCount: 1, track: "focused", specialists: ["cx-product-manager"], productFlavor: "product" },
    { request: "analyze retention funnel metrics by account segment", fileCount: 2, moduleCount: 1, track: "focused", specialists: ["cx-data-analyst"], roleFlavors: { dataAnalyst: "product" } },
    { request: "design vector retrieval indexing for product intelligence artifacts", fileCount: 2, moduleCount: 1, track: "orchestrated", specialists: ["cx-architect", "cx-data-engineer"], roleFlavors: { architect: "ai-systems", dataEngineer: "vector-retrieval" } },
    { request: "security audit prompt injection and retrieval access controls", fileCount: 2, moduleCount: 1, track: "orchestrated", specialists: ["cx-security"], roleFlavors: { security: "ai", qa: "ai-eval" } },
    { request: "is this ready to ship", fileCount: 2, moduleCount: 1, track: "focused", specialists: ["cx-reviewer"] },
    { request: "run full autonomous build", fileCount: 4, moduleCount: 2, explicitDrive: true, track: "orchestrated", specialists: ["cx-architect", "cx-engineer", "cx-reviewer", "cx-qa"] },
  ];

  for (const { request, fileCount, moduleCount, explicitDrive, track, specialists, productFlavor, roleFlavors } of routingTable) {
    it(`"${request}" → ${track}${specialists.length ? ` via ${specialists.join(" + ")}` : ""}`, () => {
      const route = routeRequest({ request, fileCount, moduleCount, explicitDrive });
      assert.equal(route.track, track);
      if (productFlavor) assert.equal(route.productFlavor, productFlavor);
      if (roleFlavors) {
        for (const [role, flavor] of Object.entries(roleFlavors)) {
          assert.equal(route.roleFlavors[role], flavor);
        }
      }
      for (const specialist of specialists) {
        assert.ok(route.specialists.includes(specialist), `${request} missing specialist ${specialist}`);
      }
    });
  }
});
