/**
 * tests/opencode-runtime-plugin.test.mjs — Tests for the OpenCode plugin.
 *
 * Covers buildRuntimeTracePayload (metadata extraction) and the plugin's
 * model fallback behavior. Telemetry calls are no-ops in the test environment
 * because LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are not set.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildRuntimeTracePayload,
  createConstructOpenCodePlugin,
  extractReadToolCalls,
  trackReadEfficiencyFromMessage,
} from "../lib/opencode-runtime-plugin.mjs";
import { resetPricingCatalog } from "../lib/telemetry/langfuse-model-sync.mjs";

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

test("buildRuntimeTracePayload includes runtime-composed prompt and route metadata", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "construct-runtime-meta-home-"));
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "construct-runtime-meta-root-"));
  fs.mkdirSync(path.join(rootDir, ".cx"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "agents", "prompts"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "agents", "registry.json"), JSON.stringify({
    models: {
      reasoning: { primary: "openrouter/deepseek/deepseek-r1" },
      standard: { primary: "openrouter/qwen/qwen3-coder:free" },
      fast: { primary: "openrouter/meta-llama/llama-3.3-70b-instruct:free" },
    },
    personas: [],
    agents: [
      {
        name: "engineer",
        promptFile: "agents/prompts/cx-engineer.md",
      },
    ],
  }, null, 2));
  fs.writeFileSync(path.join(rootDir, "agents", "prompts", "cx-engineer.md"), "# Engineer\n\nExecute implementation work.\n");
  fs.writeFileSync(path.join(rootDir, ".cx", "context.json"), JSON.stringify({
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
          agent: "cx-engineer",
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
    { env: { USER: "gerald", HOME: home, CX_TOOLKIT_DIR: rootDir } },
  );

  assert.equal(payload.metadata.taskPacketKey, undefined);
  assert.equal(payload.metadata.routeIntent, "fix");
  assert.equal(payload.metadata.routeTrack, "immediate");
  assert.deepEqual(payload.metadata.routeSpecialists, []);
  assert.equal(payload.metadata.executionContractModel.version, "v1");
  assert.equal(payload.metadata.executionContractModel.workCategory, "quick");
  assert.equal(payload.metadata.executionContractModel.selectedTier, "fast");
  assert.equal(payload.metadata.executionContractModel.selectedModel, "openrouter/meta-llama/llama-3.3-70b-instruct:free");
  assert.equal(payload.metadata.executionContractModel.selectedModelSource, "registry default");
  assert.equal(payload.metadata.promptHasTaskPacket, false);
  assert.ok(payload.metadata.promptHasContextDigest);
  assert.ok(payload.metadata.promptHasHostConstraints);
  assert.equal(payload.metadata.composedPromptVersion.length, 12);
});

test("buildRuntimeTracePayload honors process env model overrides in execution-contract metadata", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "construct-runtime-meta-override-home-"));
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "construct-runtime-meta-override-root-"));
  fs.mkdirSync(path.join(rootDir, ".cx"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "agents", "prompts"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "agents", "registry.json"), JSON.stringify({
    models: {
      reasoning: { primary: "registry/reasoning" },
      standard: { primary: "registry/standard" },
      fast: { primary: "registry/fast" },
    },
    personas: [],
    agents: [{ name: "engineer", promptFile: "agents/prompts/cx-engineer.md" }],
  }, null, 2));
  fs.writeFileSync(path.join(rootDir, "agents", "prompts", "cx-engineer.md"), "# Engineer\n");
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
          agent: "cx-engineer",
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
        CX_TOOLKIT_DIR: rootDir,
        CX_MODEL_REASONING: "env/reasoning",
        CX_MODEL_STANDARD: "env/standard",
        CX_MODEL_FAST: "env/fast",
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
  assert.equal(payload.metadata.costSource, "estimated:static");
  assert.equal(payload.input.pricing.costSource, "estimated:static");
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

test("plugin applies model fallback and logs warning when rate limit error hits", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "construct-plugin-home-"));
  const toolkitDir = fs.mkdtempSync(path.join(os.tmpdir(), "construct-toolkit-"));
  const binDir = path.join(toolkitDir, "bin");

  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "construct"), "#!/usr/bin/env bash\nexit 0\n");
  fs.chmodSync(path.join(binDir, "construct"), 0o755);
  fs.mkdirSync(path.join(toolkitDir, ".cx"), { recursive: true });
  fs.mkdirSync(path.join(toolkitDir, "agents"), { recursive: true });
  fs.writeFileSync(path.join(toolkitDir, ".env"), "CX_MODEL_STANDARD=anthropic/claude-sonnet-4-6\n");
  fs.writeFileSync(path.join(toolkitDir, "agents", "registry.json"), JSON.stringify({
    models: {
      standard: { primary: "openrouter/qwen/qwen3-coder:free", fallback: ["anthropic/claude-sonnet-4-6"] },
    },
    personas: [],
    agents: [],
  }, null, 2));

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

  const state = JSON.parse(fs.readFileSync(path.join(home, ".cx", "construct-opencode-fallback.json"), "utf8"));
  assert.equal(state.targetModel, "openrouter/qwen/qwen3-coder:free");
  assert.ok(logs.some((entry) => entry.message.includes("applying model fallback toward")));
});

test("plugin falls back to a new target model when the current provider is unavailable", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "construct-plugin-home-fallback-"));
  const toolkitDir = fs.mkdtempSync(path.join(os.tmpdir(), "construct-toolkit-fallback-"));
  const binDir = path.join(toolkitDir, "bin");

  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "construct"), "#!/usr/bin/env bash\nexit 0\n");
  fs.chmodSync(path.join(binDir, "construct"), 0o755);
  fs.mkdirSync(path.join(toolkitDir, ".cx"), { recursive: true });
  fs.mkdirSync(path.join(toolkitDir, "agents"), { recursive: true });
  fs.writeFileSync(path.join(toolkitDir, ".env"), "CX_MODEL_STANDARD=anthropic/claude-sonnet-4-6\n");
  fs.writeFileSync(path.join(toolkitDir, "agents", "registry.json"), JSON.stringify({
    models: {
      reasoning: { primary: "anthropic/claude-opus-4-6", fallback: ["openrouter/deepseek/deepseek-r1"] },
      standard: { primary: "openrouter/qwen/qwen3-coder:free", fallback: ["anthropic/claude-sonnet-4-6"] },
      fast: { primary: "openrouter/meta-llama/llama-3.3-70b-instruct:free" },
    },
    personas: [],
    agents: [],
  }, null, 2));

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
      CX_TOOLKIT_DIR: toolkitDir,
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

  const state = JSON.parse(fs.readFileSync(path.join(home, ".cx", "construct-opencode-fallback.json"), "utf8"));
  assert.equal(state.targetModel, "openrouter/qwen/qwen3-coder:free");
  assert.equal(state.targetTier, "standard");
  assert.ok(logs.some((entry) => entry.message.includes("openrouter/qwen/qwen3-coder:free")));
});

test("plugin no-ops when no safe fallback target exists", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "construct-plugin-home-nosafe-"));
  const toolkitDir = fs.mkdtempSync(path.join(os.tmpdir(), "construct-toolkit-nosafe-"));
  const binDir = path.join(toolkitDir, "bin");

  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "construct"), "#!/usr/bin/env bash\nexit 0\n");
  fs.chmodSync(path.join(binDir, "construct"), 0o755);
  fs.mkdirSync(path.join(toolkitDir, ".cx"), { recursive: true });
  fs.mkdirSync(path.join(toolkitDir, "agents"), { recursive: true });
  fs.writeFileSync(path.join(toolkitDir, ".env"), "CX_MODEL_STANDARD=anthropic/claude-sonnet-4-6\n");
  fs.writeFileSync(path.join(toolkitDir, "agents", "registry.json"), JSON.stringify({
    models: {
      standard: { primary: "anthropic/claude-sonnet-4-6", fallback: ["anthropic/claude-opus-4-6"] },
    },
    personas: [],
    agents: [],
  }, null, 2));

  const logs = [];
  const pluginFactory = createConstructOpenCodePlugin({
    toolkitDir,
    configPath: path.join(os.tmpdir(), "opencode-empty-nosafe.json"),
    env: {
      HOME: home,
      OPENROUTER_API_KEY: "or-test-key",
      CX_TOOLKIT_DIR: toolkitDir,
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

  assert.equal(fs.existsSync(path.join(home, ".cx", "construct-opencode-fallback.json")), false);
  assert.ok(logs.some((entry) => entry.message.includes("no safe fallback target")));
});

test("plugin continues fallback even when telemetry logging fails", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "construct-plugin-home-telemetry-"));
  const toolkitDir = fs.mkdtempSync(path.join(os.tmpdir(), "construct-toolkit-telemetry-"));
  const binDir = path.join(toolkitDir, "bin");

  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "construct"), "#!/usr/bin/env bash\nexit 0\n");
  fs.chmodSync(path.join(binDir, "construct"), 0o755);
  fs.mkdirSync(path.join(toolkitDir, ".cx"), { recursive: true });
  fs.mkdirSync(path.join(toolkitDir, "agents"), { recursive: true });
  fs.writeFileSync(path.join(toolkitDir, ".env"), "CX_MODEL_STANDARD=anthropic/claude-sonnet-4-6\n");
  fs.writeFileSync(path.join(toolkitDir, "agents", "registry.json"), JSON.stringify({
    models: {
      standard: { primary: "openrouter/qwen/qwen3-coder:free", fallback: ["anthropic/claude-sonnet-4-6"] },
    },
    personas: [],
    agents: [],
  }, null, 2));

  const pluginFactory = createConstructOpenCodePlugin({
    toolkitDir,
    configPath: path.join(os.tmpdir(), "opencode-empty-telemetry.json"),
    env: {
      HOME: home,
      OPENROUTER_API_KEY: "or-test-key",
      CX_TOOLKIT_DIR: toolkitDir,
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

  const state = JSON.parse(fs.readFileSync(path.join(home, ".cx", "construct-opencode-fallback.json"), "utf8"));
  assert.equal(state.reason, "opencode-session-error");
  assert.equal(state.targetModel, "openrouter/qwen/qwen3-coder:free");
});

test("plugin does not crash when Langfuse is not configured and telemetry is skipped", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "construct-plugin-nolangfuse-"));
  const toolkitDir = fs.mkdtempSync(path.join(os.tmpdir(), "construct-toolkit-nolangfuse-"));
  const configPath = path.join(os.tmpdir(), "opencode-nolangfuse.json");
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

test("trackReadEfficiencyFromMessage updates shared session-efficiency store and warns on repeats", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "construct-opencode-eff-"));
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

  const stats = JSON.parse(fs.readFileSync(path.join(home, ".cx", "session-efficiency.json"), "utf8"));
  assert.equal(stats.readCount, 7);
  assert.equal(stats.repeatedReadCount, 5);
  assert.ok(stats.warnings.repeatedReads);
  // repeated-read warning fires the turn it crosses the threshold
  const combined = JSON.stringify(warnings);
  assert.ok(combined.includes("repeated reads") || stats.warnings.repeatedReads);
});

test("trackReadEfficiencyFromMessage deduplicates by tool call id across message.updated events", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "construct-opencode-eff-dedup-"));
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
  const stats = JSON.parse(fs.readFileSync(path.join(home, ".cx", "session-efficiency.json"), "utf8"));
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
