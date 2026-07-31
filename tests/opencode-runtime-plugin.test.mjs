/**
 * tests/opencode-runtime-plugin.test.mjs — Tests for the OpenCode plugin.
 *
 * Covers buildRuntimeTracePayload (metadata extraction) and the plugin's
 * model fallback behavior. Telemetry calls are no-ops in the test environment
 * because CONSTRUCT_TELEMETRY_PUBLIC_KEY and CONSTRUCT_TELEMETRY_SECRET_KEY are not set.
 */
import assert from "node:assert/strict";
import { cpSync } from "node:fs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildRuntimeTracePayload,
  createConstructOpenCodePlugin,
  extractReadToolCalls,
  trackReadEfficiencyFromMessage,
  emitSessionPrelude,
  _resetPreludeForTests,
  detectUnavailableToolRejections,
  recordUnavailableToolRejections,
} from "../lib/opencode-runtime-plugin.mjs";
import { resetPricingCatalog } from "../lib/telemetry/model-pricing-catalog.mjs";
import { doctorRoot } from "../lib/config/xdg.mjs";
import { summarizeToolFailures } from "../lib/mcp/tool-recovery.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TEST_REGISTRY_MODELS = {
  reasoning: { primary: "openrouter/deepseek/deepseek-r1" },
  standard: { primary: "openrouter/qwen/qwen3-coder:free", fallback: ["anthropic/claude-sonnet-4-6"] },
  fast: { primary: "openrouter/meta-llama/llama-3.3-70b-instruct:free" },
};

function seedToolkitDir(toolkitDir, { models = TEST_REGISTRY_MODELS } = {}) {
  fs.mkdirSync(toolkitDir, { recursive: true });
  cpSync(path.join(REPO_ROOT, "registry"), path.join(toolkitDir, "registry"), { recursive: true });
  if (models) {
    fs.writeFileSync(
      path.join(toolkitDir, "registry", "models.json"),
      JSON.stringify({ models }, null, 2),
    );
  }
}

// createConstructOpenCodePlugin's trace emission resolves the machine-scoped
// state root via CONSTRUCT_HOME_OVERRIDE read in-process, not via the
// `env` option passed to the factory — pin it around a test or the plugin
// writes into the real developer machine's home. Callers register the
// returned unpin function with t.after().
function pinHomeOverride(home) {
  const prev = process.env.CONSTRUCT_HOME_OVERRIDE;
  process.env.CONSTRUCT_HOME_OVERRIDE = home;
  return () => {
    if (prev === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
    else process.env.CONSTRUCT_HOME_OVERRIDE = prev;
  };
}

test("buildRuntimeTracePayload creates deterministic OpenCode runtime trace metadata", () => {
  const payload = buildRuntimeTracePayload(
    {
      type: "session.error",
      timestamp: "2026-04-17T19:00:00.000Z",
      session: { id: "sess-123", agent: "construct" },
      error: { message: "Provider usage limit reached" },
    },
    { env: { USER: "gerald" } },
  );

  assert.equal(payload.id, "opencode:sess-123:session.error:2026-04-17T19:00:00.000Z");
  assert.equal(payload.name, "opencode.session.error");
  assert.equal(payload.sessionId, "sess-123");
  assert.equal(payload.userId, "gerald");
  assert.deepEqual(payload.tags, ["opencode", "runtime", "session-error"]);
  assert.equal(payload.metadata.source, "opencode-plugin");
  assert.equal(payload.metadata.agent, "construct");
  assert.equal(payload.metadata.errorCategory, "rate_limit_or_timeout");
  assert.equal(payload.output.kind, "session_error");
  assert.equal(payload.output.error.errorCategory, "rate_limit_or_timeout");
});

test("buildRuntimeTracePayload includes token usage metadata when usage is present", () => {
  const payload = buildRuntimeTracePayload(
    {
      type: "session.idle",
      timestamp: "2026-04-17T19:00:00.000Z",
      session: { id: "sess-usage", agent: "construct" },
      usage: { input_tokens: 200, output_tokens: 45, total_tokens: 245 },
    },
    { env: { USER: "gerald" } },
  );

  assert.equal(payload.metadata.inputTokens, 200);
  assert.equal(payload.metadata.outputTokens, 45);
  assert.equal(payload.metadata.totalTokens, 245);
});

test("buildRuntimeTracePayload returns null for unknown event types", () => {
  const payload = buildRuntimeTracePayload({ type: "unknown.event" });
  assert.equal(payload, null);
});

test("buildRuntimeTracePayload extracts tokens from message.updated assistant event", () => {
  const payload = buildRuntimeTracePayload(
    {
      type: "message.updated",
      timestamp: "2026-04-18T10:00:00.000Z",
      properties: {
        info: {
          id: "msg-1",
          sessionID: "sess-abc",
          role: "assistant",
          agent: "construct",
          modelID: "claude-sonnet-4-6",
          providerID: "anthropic",
          cost: 0.0123,
          time: { completed: Date.now() },
          tokens: {
            input: 100,
            output: 50,
            reasoning: 10,
            cache: { read: 30, write: 20 },
          },
        },
      },
    },
    { env: { USER: "gerald" } },
  );

  assert.ok(payload, "payload should be emitted");
  assert.equal(payload.sessionId, "sess-abc");
  assert.equal(payload.metadata.inputTokens, 100);
  assert.equal(payload.metadata.outputTokens, 50);
  assert.equal(payload.metadata.reasoningTokens, 10);
  assert.equal(payload.metadata.cacheReadInputTokens, 30);
  assert.equal(payload.metadata.cacheCreationInputTokens, 20);
  assert.equal(payload.metadata.modelName, "claude-sonnet-4-6");
  assert.equal(payload.metadata.provider, "anthropic");
  assert.ok(payload.metadata.costUsd > 0);
  assert.equal(payload.output.kind, "assistant_message");
  assert.equal(payload.output.hasText, false);
  assert.equal(payload.output.partSummary.textSegments, 0);
  assert.equal(payload.output.partSummary.toolCalls, 0);
});

test("buildRuntimeTracePayload returns structured assistant output when no plain text exists", () => {
  const payload = buildRuntimeTracePayload(
    {
      type: "message.updated",
      timestamp: "2026-04-18T10:00:00.000Z",
      properties: {
        info: {
          id: "msg-structured",
          sessionID: "sess-structured",
          role: "assistant",
          agent: "construct",
          modelID: "claude-sonnet-4-6",
          providerID: "anthropic",
          time: { completed: Date.now() },
          tokens: { input: 40, output: 12 },
          parts: [
            { type: "tool", tool: "read", state: { status: "completed", input: { filePath: "/a.txt" } } },
          ],
        },
      },
    },
    { env: { USER: "gerald" } },
  );

  assert.equal(payload.output.kind, "assistant_message");
  assert.equal(payload.output.hasText, false);
  assert.equal(payload.output.text, undefined);
  assert.equal(payload.output.partSummary.toolCalls, 1);
  assert.deepEqual(payload.output.partSummary.toolNames, ["read"]);
});

test("buildRuntimeTracePayload includes runtime-composed prompt and route metadata", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "construct-runtime-meta-home-"));
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "construct-runtime-meta-root-"));
  t.after(() => {
    try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch {}
  });
  fs.mkdirSync(path.join(rootDir, ".construct"), { recursive: true });
  seedToolkitDir(rootDir);
  fs.writeFileSync(path.join(rootDir, ".construct", "context.json"), JSON.stringify({
    format: "json",
    savedAt: "2026-04-19T00:00:00.000Z",
    contextSummary: "Prompt routing is being moved into code.",
    activeWork: ["runtime prompt composition"],
  }, null, 2));
  fs.writeFileSync(path.join(rootDir, "plan.md"), "# Plan\n\n- Keep runtime routing policy code-backed.\n- Coordinate through tracker plus plan.\n");

  const payload = buildRuntimeTracePayload(
    {
      type: "message.updated",
      timestamp: "2026-04-19T10:00:00.000Z",
      properties: {
        info: {
          id: "msg-2",
          sessionID: "sess-route",
          role: "assistant",
          agent: "engineer",
          modelID: "gpt-5.4",
          providerID: "github-copilot",
          time: { completed: Date.now() },
          tokens: { input: 50, output: 20 },
          parts: [
            { type: "tool", tool: "read", state: { status: "completed", input: { request: "fix the routing bug across auth and session modules" } } },
            { type: "text", text: "Done." },
          ],
        },
      },
    },
    {
      env: {
        USER: "gerald",
        HOME: home,
        CONSTRUCT_TOOLKIT_DIR: rootDir,
        CONSTRUCT_MODEL_FAST: "openrouter/meta-llama/llama-3.3-70b-instruct:free",
      },
    },
  );

  assert.equal(payload.metadata.taskPacketKey, undefined);
  assert.equal(payload.metadata.routeIntent, "fix");
  assert.equal(payload.metadata.routeTrack, "immediate");
  assert.deepEqual(payload.metadata.routeWorkerProfiles, []);
  assert.equal(payload.metadata.executionContractModel.version, "v1");
  assert.equal(payload.metadata.executionContractModel.workCategory, "quick");
  assert.equal(payload.metadata.executionContractModel.selectedTier, "fast");
  assert.equal(payload.metadata.executionContractModel.selectedModel, "openrouter/meta-llama/llama-3.3-70b-instruct:free");
  assert.equal(payload.metadata.executionContractModel.selectedModelSource, "env override");
  assert.equal(payload.metadata.promptHasTaskPacket, false);
  assert.ok(payload.metadata.promptHasContextDigest);
  assert.ok(payload.metadata.promptHasHostConstraints);
  assert.equal(payload.metadata.composedPromptVersion.length, 12);
});

test("buildRuntimeTracePayload honors process env model overrides in execution-contract metadata", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "construct-runtime-meta-override-home-"));
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "construct-runtime-meta-override-root-"));
  t.after(() => {
    try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch {}
  });
  fs.mkdirSync(path.join(rootDir, ".construct"), { recursive: true });
  seedToolkitDir(rootDir, { models: null });
  fs.writeFileSync(path.join(rootDir, ".env"), "");

  const payload = buildRuntimeTracePayload(
    {
      type: "message.updated",
      timestamp: "2026-04-19T10:00:00.000Z",
      properties: {
        info: {
          id: "msg-override",
          sessionID: "sess-override",
          role: "assistant",
          agent: "engineer",
          time: { completed: Date.now() },
          tokens: { input: 20, output: 10 },
          parts: [
            { type: "tool", tool: "read", state: { status: "completed", input: { request: "fix routing issue" } } },
          ],
        },
      },
    },
    {
      env: {
        USER: "gerald",
        HOME: home,
        CONSTRUCT_TOOLKIT_DIR: rootDir,
        CONSTRUCT_MODEL_REASONING: "env/reasoning",
        CONSTRUCT_MODEL_STANDARD: "env/standard",
        CONSTRUCT_MODEL_FAST: "env/fast",
      },
    },
  );

  assert.deepEqual(payload.metadata.executionContractModel.tiers, {
    reasoning: { model: 'env/reasoning', source: 'env override' },
    standard: { model: 'env/standard', source: 'env override' },
    fast: { model: 'env/fast', source: 'env override' },
  });
  assert.equal(payload.metadata.executionContractModel.selectedTier, 'fast');
  assert.equal(payload.metadata.executionContractModel.selectedModel, 'env/fast');
  assert.equal(payload.metadata.executionContractModel.selectedModelSource, 'env override');
});

test("buildRuntimeTracePayload estimates non-zero cost from pricing metadata", () => {
  resetPricingCatalog();
  const payload = buildRuntimeTracePayload(
    {
      type: "session.idle",
      timestamp: "2026-04-17T19:00:00.000Z",
      session: { id: "sess-cost", agent: "construct", model: { provider: "anthropic", id: "claude-sonnet-4-6" } },
      usage: { input_tokens: 1000, output_tokens: 500 },
      model: { provider: "anthropic", id: "claude-sonnet-4-6" },
    },
    { env: { USER: "gerald" } },
  );

  assert.ok(payload.metadata.costUsd > 0);
  assert.equal(payload.metadata.costSource, "estimated:static-fallback");
  assert.equal(payload.input.pricing.costSource, "estimated:static-fallback");
});

test("buildRuntimeTracePayload skips message.updated for user role or incomplete messages", () => {
  const baseInfo = {
    id: "msg-2",
    sessionID: "sess-xyz",
    agent: "construct",
    tokens: { input: 10, output: 5 },
    time: { completed: 1 },
  };
  assert.equal(buildRuntimeTracePayload({ type: "message.updated", properties: { info: { ...baseInfo, role: "user" } } }), null);
  assert.equal(buildRuntimeTracePayload({ type: "message.updated", properties: { info: { ...baseInfo, role: "assistant", time: {} } } }), null);
  assert.equal(buildRuntimeTracePayload({ type: "message.updated", properties: { info: { ...baseInfo, role: "assistant", tokens: { input: 0, output: 0 } } } }), null);
});

test("plugin applies model fallback and logs warning when rate limit error hits", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "construct-plugin-home-"));
  const toolkitDir = fs.mkdtempSync(path.join(os.tmpdir(), "construct-toolkit-"));
  const unpinHome = pinHomeOverride(home);
  t.after(() => {
    unpinHome();
    try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(toolkitDir, { recursive: true, force: true }); } catch {}
  });
  const binDir = path.join(toolkitDir, "bin");

  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "construct"), "#!/usr/bin/env bash\nexit 0\n");
  fs.chmodSync(path.join(binDir, "construct"), 0o755);
  fs.mkdirSync(path.join(toolkitDir, ".construct"), { recursive: true });
  seedToolkitDir(toolkitDir);
  fs.writeFileSync(path.join(toolkitDir, ".env"), "CONSTRUCT_MODEL_STANDARD=anthropic/claude-sonnet-4-6\n");

  const configPath = path.join(os.tmpdir(), "opencode-empty.json");
  fs.writeFileSync(configPath, JSON.stringify({
    provider: { openrouter: { options: { headers: { Authorization: "Bearer or-test-key" } } } },
  }));

  const logs = [];
  const pluginFactory = createConstructOpenCodePlugin({
    toolkitDir,
    configPath,
    env: {
      HOME: home,
      OPENROUTER_API_KEY: "or-test-key",
    },
  });

  const plugin = await pluginFactory({
    client: {
      app: {
        log: async ({ body }) => logs.push(body),
      },
    },
  });

  await plugin.event({
    event: {
      type: "session.error",
      timestamp: "2026-04-17T19:00:00.000Z",
      error: { message: "429 usage limit reached", provider: "anthropic" },
    },
  });

  const state = JSON.parse(fs.readFileSync(path.join(doctorRoot(home), "construct-opencode-fallback.json"), "utf8"));
  assert.equal(state.targetModel, "openrouter/qwen/qwen3-coder:free");
  assert.ok(logs.some((entry) => entry.message.includes("applying model fallback toward")));
});

test("plugin falls back to a new target model when the current provider is unavailable", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "construct-plugin-home-fallback-"));
  const toolkitDir = fs.mkdtempSync(path.join(os.tmpdir(), "construct-toolkit-fallback-"));
  const unpinHome = pinHomeOverride(home);
  t.after(() => {
    unpinHome();
    try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(toolkitDir, { recursive: true, force: true }); } catch {}
  });
  const binDir = path.join(toolkitDir, "bin");

  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "construct"), "#!/usr/bin/env bash\nexit 0\n");
  fs.chmodSync(path.join(binDir, "construct"), 0o755);
  fs.mkdirSync(path.join(toolkitDir, ".construct"), { recursive: true });
  seedToolkitDir(toolkitDir);
  fs.writeFileSync(path.join(toolkitDir, ".env"), "CONSTRUCT_MODEL_STANDARD=anthropic/claude-sonnet-4-6\n");

  const configPath = path.join(os.tmpdir(), "opencode-empty-fallback.json");
  fs.writeFileSync(configPath, JSON.stringify({
    provider: { openrouter: { options: { headers: { Authorization: "Bearer or-test-key" } } } },
  }));

  const logs = [];
  const pluginFactory = createConstructOpenCodePlugin({
    toolkitDir,
    configPath,
    env: {
      HOME: home,
      OPENROUTER_API_KEY: "or-test-key",
      CONSTRUCT_TOOLKIT_DIR: toolkitDir,
    },
  });

  const plugin = await pluginFactory({
    client: {
      app: {
        log: async ({ body }) => logs.push(body),
      },
    },
  });

  await plugin.event({
    event: {
      type: "session.error",
      timestamp: "2026-04-17T19:00:00.000Z",
      error: { message: "model unavailable", provider: "anthropic" },
    },
  });

  const state = JSON.parse(fs.readFileSync(path.join(doctorRoot(home), "construct-opencode-fallback.json"), "utf8"));
  assert.equal(state.targetModel, "openrouter/qwen/qwen3-coder:free");
  assert.equal(state.targetTier, "standard");
  assert.ok(logs.some((entry) => entry.message.includes("openrouter/qwen/qwen3-coder:free")));
});

test("plugin no-ops when no safe fallback target exists", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "construct-plugin-home-nosafe-"));
  const toolkitDir = fs.mkdtempSync(path.join(os.tmpdir(), "construct-toolkit-nosafe-"));
  const unpinHome = pinHomeOverride(home);
  t.after(() => {
    unpinHome();
    try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(toolkitDir, { recursive: true, force: true }); } catch {}
  });
  const binDir = path.join(toolkitDir, "bin");

  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "construct"), "#!/usr/bin/env bash\nexit 0\n");
  fs.chmodSync(path.join(binDir, "construct"), 0o755);
  fs.mkdirSync(path.join(toolkitDir, ".construct"), { recursive: true });
  seedToolkitDir(toolkitDir, { models: null });
  fs.writeFileSync(path.join(toolkitDir, ".env"), "CONSTRUCT_MODEL_STANDARD=anthropic/claude-sonnet-4-6\n");

  const logs = [];
  const pluginFactory = createConstructOpenCodePlugin({
    toolkitDir,
    configPath: path.join(os.tmpdir(), "opencode-empty-nosafe.json"),
    env: {
      HOME: home,
      OPENROUTER_API_KEY: "or-test-key",
      CONSTRUCT_TOOLKIT_DIR: toolkitDir,
    },
  });

  const plugin = await pluginFactory({
    client: {
      app: {
        log: async ({ body }) => logs.push(body),
      },
    },
  });

  await plugin.event({
    event: {
      type: "session.error",
      timestamp: "2026-04-17T19:00:00.000Z",
      error: { message: "model unavailable", provider: "anthropic" },
    },
  });

  assert.equal(fs.existsSync(path.join(doctorRoot(home), "construct-opencode-fallback.json")), false);
  assert.ok(logs.some((entry) => entry.message.includes("no safe fallback target")));
});

test("plugin continues fallback even when telemetry logging fails", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "construct-plugin-home-telemetry-"));
  const toolkitDir = fs.mkdtempSync(path.join(os.tmpdir(), "construct-toolkit-telemetry-"));
  const unpinHome = pinHomeOverride(home);
  t.after(() => {
    unpinHome();
    try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(toolkitDir, { recursive: true, force: true }); } catch {}
  });
  const binDir = path.join(toolkitDir, "bin");

  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "construct"), "#!/usr/bin/env bash\nexit 0\n");
  fs.chmodSync(path.join(binDir, "construct"), 0o755);
  fs.mkdirSync(path.join(toolkitDir, ".construct"), { recursive: true });
  seedToolkitDir(toolkitDir);
  fs.writeFileSync(path.join(toolkitDir, ".env"), "CONSTRUCT_MODEL_STANDARD=anthropic/claude-sonnet-4-6\n");

  const pluginFactory = createConstructOpenCodePlugin({
    toolkitDir,
    configPath: path.join(os.tmpdir(), "opencode-empty-telemetry.json"),
    env: {
      HOME: home,
      OPENROUTER_API_KEY: "or-test-key",
      CONSTRUCT_TOOLKIT_DIR: toolkitDir,
    },
  });

  const plugin = await pluginFactory({
    client: {
      app: {
        log: async () => { throw new Error("telemetry down"); },
      },
    },
  });

  await plugin.event({
    event: {
      type: "session.error",
      timestamp: "2026-04-17T19:00:00.000Z",
      error: { message: "429 usage limit reached", provider: "anthropic" },
    },
  });

  const state = JSON.parse(fs.readFileSync(path.join(doctorRoot(home), "construct-opencode-fallback.json"), "utf8"));
  assert.equal(state.reason, "opencode-session-error");
  assert.equal(state.targetModel, "openrouter/qwen/qwen3-coder:free");
});

test("plugin does not crash when telemetry is not configured", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "construct-plugin-notelemetry-"));
  const toolkitDir = fs.mkdtempSync(path.join(os.tmpdir(), "construct-toolkit-notelemetry-"));
  const unpinHome = pinHomeOverride(home);
  t.after(() => {
    unpinHome();
    try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(toolkitDir, { recursive: true, force: true }); } catch {}
  });
  const configPath = path.join(os.tmpdir(), "opencode-notelemetry.json");
  fs.writeFileSync(configPath, JSON.stringify({}));

  const logs = [];
  const pluginFactory = createConstructOpenCodePlugin({
    toolkitDir,
    configPath,
    env: { HOME: home },
  });

  const plugin = await pluginFactory({
    client: { app: { log: async ({ body }) => logs.push(body) } },
  });

  await plugin.event({
    event: {
      type: "session.idle",
      timestamp: "2026-04-17T19:00:00.000Z",
      session: { id: "sess-99", agent: "construct" },
    },
  });

  // No crash — a telemetry-failure warn is acceptable, but the plugin must not throw.
  const warnLogs = logs.filter((l) => l.level === "warn" && l.message.includes("telemetry"));
  assert.ok(warnLogs.length <= 1);
});

test("extractReadToolCalls handles tool and tool-invocation part shapes", () => {
  const info = {
    parts: [
      { type: "text", text: "hello" },
      { type: "tool", tool: "read", state: { status: "completed", input: { filePath: "/a.txt" } }, callID: "c1" },
      { type: "tool-invocation", toolInvocation: { toolName: "Read", args: { filePath: "/b.txt", limit: 500 }, toolCallId: "c2", state: "result" } },
      { type: "tool", tool: "bash", state: { status: "completed", input: { command: "ls" } }, callID: "c3" },
      { type: "tool", tool: "read", state: { status: "running", input: { filePath: "/c.txt" } }, callID: "c4" },
    ],
  };
  const calls = extractReadToolCalls(info);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].filePath, "/a.txt");
  assert.equal(calls[1].filePath, "/b.txt");
  assert.equal(calls[1].limit, 500);
});

test("trackReadEfficiencyFromMessage updates shared session-efficiency store and warns on repeats", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "construct-opencode-eff-"));
  t.after(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch {} });
  const env = { HOME: home };
  const makeEvent = (callId, filePath) => ({
    type: "message.updated",
    properties: {
      info: {
        role: "assistant",
        time: { completed: Date.now() },
        parts: [{ type: "tool", tool: "read", state: { status: "completed", input: { filePath } }, callID: callId }],
      },
    },
  });

  for (let i = 0; i < 6; i += 1) {
    trackReadEfficiencyFromMessage(makeEvent(`c-${i}`, "/repeat.txt"), { env, cwd: home });
  }
  const { warnings } = trackReadEfficiencyFromMessage(makeEvent("c-dup-0", "/another.txt"), { env, cwd: home });

  const stats = JSON.parse(fs.readFileSync(path.join(doctorRoot(home), "session-efficiency.json"), "utf8"));
  assert.equal(stats.readCount, 7);
  assert.equal(stats.repeatedReadCount, 5);
  assert.ok(stats.warnings.repeatedReads);
  // repeated-read warning fires the turn it crosses the threshold
  const combined = JSON.stringify(warnings);
  assert.ok(combined.includes("repeated reads") || stats.warnings.repeatedReads);
});

test("trackReadEfficiencyFromMessage deduplicates by tool call id across message.updated events", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "construct-opencode-eff-dedup-"));
  t.after(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch {} });
  const env = { HOME: home };
  const event = {
    type: "message.updated",
    properties: {
      info: {
        role: "assistant",
        time: { completed: Date.now() },
        parts: [{ type: "tool", tool: "read", state: { status: "completed", input: { filePath: "/x.txt" } }, callID: "fixed" }],
      },
    },
  };
  trackReadEfficiencyFromMessage(event, { env, cwd: home });
  trackReadEfficiencyFromMessage(event, { env, cwd: home });
  const stats = JSON.parse(fs.readFileSync(path.join(doctorRoot(home), "session-efficiency.json"), "utf8"));
  assert.equal(stats.readCount, 1);
});

test("buildRuntimeTracePayload produces session_error kind with error metadata and hasError flag", () => {
  const payload = buildRuntimeTracePayload(
    {
      type: "session.error",
      timestamp: "2026-04-18T10:00:00.000Z",
      session: { id: "sess-err", agent: "construct" },
      error: {
        message: "429 rate limit exceeded",
        provider: "anthropic",
        status: 429,
        name: "RateLimitError",
      },
    },
    { env: { USER: "gerald" } },
  );

  assert.ok(payload, "payload should not be null");
  assert.equal(payload.output.kind, "session_error");
  assert.equal(payload.output.traceQualityFlags.hasError, true);
  assert.equal(payload.output.traceQualityFlags.hasText, false);
  assert.ok(payload.output.error, "error field should be present");
  assert.equal(payload.output.error.errorCategory, "rate_limit_or_timeout");
  assert.equal(payload.output.error.provider, "anthropic");
  assert.equal(payload.output.provider, "anthropic");
});

test("buildRuntimeTracePayload produces runtime_event kind with status for session.idle", () => {
  const payload = buildRuntimeTracePayload(
    {
      type: "session.idle",
      timestamp: "2026-04-18T10:05:00.000Z",
      session: { id: "sess-idle", agent: "construct", status: "idle" },
    },
    { env: { USER: "gerald" } },
  );

  assert.ok(payload, "payload should not be null");
  assert.equal(payload.output.kind, "runtime_event");
  assert.equal(payload.output.eventType, "session.idle");
  assert.equal(payload.output.traceQualityFlags.hasText, false);
  assert.equal(payload.output.traceQualityFlags.hasError, false);
  assert.equal(payload.output.status, "idle");
});

test("emitSessionPrelude surfaces the broker status + pending intake on session.created via client.app.log", async () => {
  _resetPreludeForTests();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cx-prelude-plugin-"));
  const pendingDir = path.join(tmp, ".construct", "intake", "pending");
  fs.mkdirSync(pendingDir, { recursive: true });
  fs.writeFileSync(path.join(pendingDir, "p1.json"), JSON.stringify({
    id: "p1",
    status: "pending",
    intake: { sourcePath: "spec.md" },
    triage: { intakeType: "feature", rdStage: "planning", primaryOwner: "engineer", risk: "low" },
  }));
  const logged = [];
  const client = {
    app: {
      log: async (entry) => { logged.push(entry); },
    },
  };
  try {
    const fired = await emitSessionPrelude(
      { type: "session.created", session: { id: "sess-prelude" }, timestamp: "2026-05-14T10:00:00.000Z" },
      {
        client,
        env: { CONSTRUCT_DEPLOYMENT_MODE: "team", CONSTRUCT_INTAKE_QUEUE_BACKEND: "filesystem" },
        cwd: tmp,
      },
    );
    assert.equal(fired, true);
    assert.equal(logged.length, 1);
    assert.equal(logged[0].body.service, "construct");
    assert.equal(logged[0].body.level, "info");
    assert.match(logged[0].body.message, /Pending R&D intake \(1\)/);
    assert.match(logged[0].body.message, /MCP broker: on/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("emitSessionPrelude fires once per session id even if session.created repeats", async () => {
  _resetPreludeForTests();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cx-prelude-once-"));
  const logged = [];
  const client = { app: { log: async (entry) => { logged.push(entry); } } };
  try {
    const event = { type: "session.created", session: { id: "sess-once" }, timestamp: "2026-05-14T10:00:00.000Z" };
    const first = await emitSessionPrelude(event, { client, env: {}, cwd: tmp });
    const second = await emitSessionPrelude(event, { client, env: {}, cwd: tmp });
    assert.equal(first, true);
    assert.equal(second, false);
    assert.equal(logged.length, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("emitSessionPrelude is a no-op for non-session.created events", async () => {
  _resetPreludeForTests();
  const logged = [];
  const client = { app: { log: async (entry) => { logged.push(entry); } } };
  const fired = await emitSessionPrelude(
    { type: "session.idle", session: { id: "sess-idle" } },
    { client, env: {} },
  );
  assert.equal(fired, false);
  assert.equal(logged.length, 0);
});

test("buildRuntimeTracePayload produces runtime_event kind for session.created", () => {
  const payload = buildRuntimeTracePayload(
    {
      type: "session.created",
      timestamp: "2026-04-18T10:00:00.000Z",
      session: { id: "sess-new", agent: "construct", status: "created" },
    },
    { env: { USER: "gerald" } },
  );

  assert.ok(payload, "payload should not be null");
  assert.equal(payload.output.kind, "runtime_event");
  assert.equal(payload.output.eventType, "session.created");
  assert.equal(payload.output.status, "created");
  assert.equal(payload.output.traceQualityFlags.hasError, false);
});

// host-side tool-miss capture for OpenCode "unavailable tool" rejections.
// Fixtures below match the session.error / message.updated shapes established earlier for
// buildRuntimeTracePayload; a live OpenCode session has not confirmed the exact rejection
// shape (see detectUnavailableToolRejections doc comment in lib/opencode-runtime-plugin.mjs).

test("detectUnavailableToolRejections matches a NoSuchToolError-style session.error", () => {
  const hits = detectUnavailableToolRejections({
    type: "session.error",
    error: { name: "AI_NoSuchToolError", message: "Model tried to call unavailable tool 'construct_ingest_v2'.", toolName: "construct_ingest_v2" },
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].source, "session.error");
  assert.equal(hits[0].tool, "construct_ingest_v2");
  assert.match(hits[0].text, /unavailable tool/i);
});

test("detectUnavailableToolRejections ignores an unrelated session.error", () => {
  const hits = detectUnavailableToolRejections({
    type: "session.error",
    error: { message: "Provider usage limit reached" },
  });
  assert.deepEqual(hits, []);
});

test("detectUnavailableToolRejections matches an error-state tool part in message.updated", () => {
  const hits = detectUnavailableToolRejections({
    type: "message.updated",
    properties: {
      info: {
        role: "assistant",
        parts: [
          { type: "text", text: "Let me check that file." },
          { type: "tool", tool: "playwright_navigate", state: { status: "error", error: "Tool 'playwright_navigate' is not available in this session." }, callID: "c1" },
          { type: "tool", tool: "read", state: { status: "completed", input: { filePath: "/a.txt" } }, callID: "c2" },
        ],
      },
    },
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].source, "message.part");
  assert.equal(hits[0].tool, "playwright_navigate");
  assert.match(hits[0].text, /not available/i);
});

test("detectUnavailableToolRejections matches the tool-invocation part shape", () => {
  const hits = detectUnavailableToolRejections({
    type: "message.updated",
    properties: {
      info: {
        role: "assistant",
        parts: [
          { type: "tool-invocation", toolInvocation: { toolName: "context7_search", state: "error", error: "no such tool: context7_search" } },
        ],
      },
    },
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].tool, "context7_search");
});

test("detectUnavailableToolRejections does not flag an unrelated tool execution error", () => {
  const hits = detectUnavailableToolRejections({
    type: "message.updated",
    properties: {
      info: {
        role: "assistant",
        parts: [
          { type: "tool", tool: "bash", state: { status: "error", error: "command exited with code 1" }, callID: "c1" },
        ],
      },
    },
  });
  assert.deepEqual(hits, []);
});

test("detectUnavailableToolRejections returns [] for event types it does not inspect", () => {
  assert.deepEqual(detectUnavailableToolRejections({ type: "session.idle" }), []);
  assert.deepEqual(detectUnavailableToolRejections(null), []);
});

test("recordUnavailableToolRejections appends a hit to the shared tool-failures observation log", (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "construct-opencode-toolmiss-"));
  t.after(() => { try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch {} });

  const hits = recordUnavailableToolRejections(
    {
      type: "session.error",
      error: { name: "AI_NoSuchToolError", message: "no such tool: memory_search", toolName: "memory_search" },
    },
    { toolkitDir: rootDir, env: {} },
  );

  assert.equal(hits.length, 1);
  const summary = summarizeToolFailures(rootDir);
  assert.equal(summary.total, 1);
  assert.equal(summary.top[0].name, "memory_search");
});

test("recordUnavailableToolRejections is a no-op when no rejection is detected", (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "construct-opencode-toolmiss-noop-"));
  t.after(() => { try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch {} });

  const hits = recordUnavailableToolRejections(
    { type: "session.error", error: { message: "Provider usage limit reached" } },
    { toolkitDir: rootDir, env: {} },
  );

  assert.deepEqual(hits, []);
  const summary = summarizeToolFailures(rootDir);
  assert.equal(summary.total, 0);
});
