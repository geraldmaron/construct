/**
 * host-capabilities.test.mjs — Unit tests for lib/host-capabilities.mjs harness detection.
 *
 * Covers: Claude Code vs OpenCode vs terminal classification, subagent
 * context detection, and multi-agent support flags.
 */
import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";

import { detectHostCapabilities, findAvailablePort } from "../lib/host-capabilities.mjs";

test("host capabilities classify full multi-agent support separately from OpenCode subagents", () => {
  const hosts = detectHostCapabilities();
  const names = hosts.map((host) => host.host);

  assert.deepEqual(names, ["Claude Code", "OpenCode", "Codex", "VS Code", "Cursor", "Copilot"]);
  assert.match(hosts.find((host) => host.host === "OpenCode").orchestration, /primary-plus-subagents|plugin-augmented-subagents/);
  assert.equal(hosts.find((host) => host.host === "OpenCode").promptableWorkers, false);
  assert.equal(hosts.find((host) => host.host === "Codex").orchestration, "profile-and-mcp");
  assert.equal(hosts.find((host) => host.host === "Cursor").orchestration, "mcp-only");
  assert.equal(hosts.find((host) => host.host === "Copilot").orchestration, "prompt-profiles");

  // Honest capability classification — every host is full-native or, via the
  // orchestration_run MCP tool, mcp-orchestrated. None is prompt-only.
  const cap = (name) => hosts.find((host) => host.host === name).capability;
  assert.equal(cap("Claude Code"), "full-native");
  assert.equal(cap("OpenCode"), "full-native");
  assert.equal(cap("Codex"), "mcp-orchestrated");
  assert.equal(cap("VS Code"), "mcp-orchestrated");
  assert.equal(cap("Cursor"), "mcp-orchestrated");
  assert.equal(cap("Copilot"), "mcp-orchestrated");
  for (const host of hosts) assert.ok(["full-native", "mcp-orchestrated", "prompt-only"].includes(host.capability), `${host.host} capability is valid`);
});

test("findAvailablePort rejects invalid port ranges before calling net.listen", async () => {
  await assert.rejects(() => findAvailablePort(65536), /startPort must be an integer between 0 and 65535/);
  await assert.rejects(() => findAvailablePort(9000, { maxPort: 8999 }), /must be less than or equal to maxPort/);
});

test("findAvailablePort stops scanning at maxPort instead of overflowing past 65535", async (t) => {
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, resolve);
    });
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("sandbox does not permit binding an ephemeral port");
      return;
    }
    throw error;
  }

  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    await assert.rejects(() => findAvailablePort(address.port, { maxPort: address.port }), /EADDRINUSE|address already in use/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
