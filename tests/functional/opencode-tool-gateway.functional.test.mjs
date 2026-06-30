/**
 * opencode-tool-gateway.functional.test.mjs — lean construct-mcp surface + gateway.
 *
 * construct-mcp exposes a lean surface (curated core + the construct_call
 * dispatcher) so the serialized tool schema fits a small window on every host;
 * the long tail stays reachable through construct_call. OpenCode 1.15.4 has no
 * per-session tool filter, so external-server trimming happens at sync time
 * (covered by opencode-local-mcp-trim) — not here. These tests lock in the
 * exposed surface and dispatch parity.
 */
import test from "node:test";
import assert from "node:assert";
import { exposedTools, dispatchToolByName } from "../../lib/mcp/server.mjs";
import { estimateToolTokens, HEAVY_EXTERNAL_MCP_IDS } from "../../lib/mcp/tool-budget.mjs";

test("construct-mcp exposes a lean surface: core tools + construct_call, long tail behind the gateway", () => {
  const tools = exposedTools();
  const names = tools.map((t) => t.name);
  assert.ok(names.includes("call"), "construct_call gateway is exposed");
  assert.ok(names.includes("orchestration_policy") && names.includes("get_skill"), "core tools stay flat");
  assert.ok(names.includes("orchestration_run"), "dispatch tool stays flat — the orchestrator's policy→run contract is one atomic unit");
  assert.ok(names.includes("orchestration_readiness"), "readiness preflight stays flat");
  assert.ok(!names.includes("workflow_status") && !names.includes("ingest_document"), "long-tail tools are not flat");
  assert.ok(names.includes("author_artifact") && names.includes("document_export"), "high-value action tools are flat");
  assert.ok(tools.length <= 18, `surface stays small (got ${tools.length})`);
  const cc = tools.find((t) => t.name === "call");
  assert.ok(cc.inputSchema.properties.tool.enum.includes("workflow_status"), "long-tail names are enumerated");
  assert.ok(estimateToolTokens(tools) < 6000, "exposed surface well under a small-window budget");
});

test("construct_call dispatches to the same handler as a direct call", async () => {
  const direct = await dispatchToolByName("capability_describe", {});
  const viaMeta = await dispatchToolByName("construct_call", { tool: "capability_describe", args: {} });
  const strip = (o) => { const c = { ...o }; delete c.generatedAt; return c; };
  assert.deepEqual(strip(viaMeta), strip(direct), "gateway dispatch is faithful (ignoring volatile timestamp)");

  const bad = await dispatchToolByName("construct_call", { tool: "does_not_exist" });
  assert.ok(bad.error, "unknown tool via gateway returns a clean error");
  const recur = await dispatchToolByName("construct_call", { tool: "construct_call" });
  assert.ok(recur.error, "gateway cannot recurse into itself");
});

test("the heavy external server list is the set sync disables for local setups", () => {
  assert.deepEqual(
    [...HEAVY_EXTERNAL_MCP_IDS].sort(),
    ["context7", "github", "memory", "playwright", "sequential-thinking"],
  );
});
