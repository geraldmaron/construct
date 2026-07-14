/**
 * host-capabilities.test.mjs — Unit tests for lib/host-capabilities.mjs harness detection.
 *
 * Covers: Claude Code vs OpenCode vs terminal classification, subagent
 * context detection, and multi-agent support flags.
 */
import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";

import { detectHostCapabilities, hostProbe, findAvailablePort } from "../lib/host-capabilities.mjs";

// Signal shapes matching detectHostRawSignals(), for injecting a deterministic
// environment (no real editor install needed on the box running the suite).
const LIVE_SIGNALS = {
  claude: "2.1.40 (Claude Code)", tmux: "tmux 3.4", opencode: "0.9.0", codex: "codex 1.2.0",
  vscode: { version: "1.99.0", hasSettings: true }, cursor: { version: "0.42.0", hasConfig: true }, copilot: { hasFiles: true },
};
const ARTIFACTS_ONLY_SIGNALS = {
  claude: null, tmux: null, opencode: null, codex: null,
  vscode: { version: null, hasSettings: true }, cursor: { version: null, hasConfig: true }, copilot: { hasFiles: true },
};
const ABSENT_SIGNALS = {
  claude: null, tmux: null, opencode: null, codex: null,
  vscode: { version: null, hasSettings: false }, cursor: { version: null, hasConfig: false }, copilot: { hasFiles: false },
};
const pick = (hosts, name) => hosts.find((h) => h.host === name);

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

test("hostProbe distinguishes a live binary from a config-file artifact from nothing (R4)", () => {
  assert.equal(hostProbe({ liveVersion: "1.2.3", hasArtifacts: true }), "live");
  assert.equal(hostProbe({ liveVersion: "1.2.3", hasArtifacts: false }), "live");
  assert.equal(hostProbe({ liveVersion: null, hasArtifacts: true }), "artifacts-only");
  assert.equal(hostProbe({ liveVersion: null, hasArtifacts: false }), "absent");
});

test("a host detected from artifacts alone reports degraded, never a healthy live runtime (construct-72gqn.24 AC)", () => {
  const hosts = detectHostCapabilities(ARTIFACTS_ONLY_SIGNALS);
  for (const name of ["VS Code", "Cursor", "Copilot"]) {
    const h = pick(hosts, name);
    assert.equal(h.probe, "artifacts-only", `${name} probe`);
    assert.equal(h.degraded, true, `${name} degraded`);
    assert.equal(h.liveCapabilityConfirmed, false, `${name} not live-confirmed`);
    assert.match(h.degradedReason, /no host binary was executed|config\/prompt files only/i);
    // availability stays a superset so adapter generation still fires — the
    // degraded flag, not availability, carries the R4 honesty.
    assert.equal(h.availability, "installed", `${name} availability unchanged`);
  }
  // A binary host with no binary is absent, not degraded — nothing to verify.
  assert.equal(pick(hosts, "Claude Code").probe, "absent");
  assert.equal(pick(hosts, "Claude Code").degraded, false);
});

test("a live binary probe reports confirmed and non-degraded", () => {
  const hosts = detectHostCapabilities(LIVE_SIGNALS);
  for (const name of ["Claude Code", "OpenCode", "Codex", "VS Code", "Cursor"]) {
    const h = pick(hosts, name);
    assert.equal(h.probe, "live", `${name} probe`);
    assert.equal(h.liveCapabilityConfirmed, true, `${name} live-confirmed`);
    assert.equal(h.degraded, false, `${name} not degraded`);
    assert.equal(h.degradedReason, null);
  }
});

test("Copilot can never be live-probed — it has no CLI binary, so present files are always artifacts-only", () => {
  assert.equal(pick(detectHostCapabilities(LIVE_SIGNALS), "Copilot").probe, "artifacts-only");
  assert.equal(pick(detectHostCapabilities(ARTIFACTS_ONLY_SIGNALS), "Copilot").degraded, true);
  assert.equal(pick(detectHostCapabilities(ABSENT_SIGNALS), "Copilot").probe, "absent");
});

test("every host record carries a valid probe and a boolean degraded flag", () => {
  for (const signals of [LIVE_SIGNALS, ARTIFACTS_ONLY_SIGNALS, ABSENT_SIGNALS]) {
    for (const h of detectHostCapabilities(signals)) {
      assert.ok(["live", "artifacts-only", "absent"].includes(h.probe), `${h.host} probe valid`);
      assert.equal(typeof h.degraded, "boolean", `${h.host} degraded is boolean`);
      assert.equal(h.degraded, h.probe === "artifacts-only", `${h.host} degraded iff artifacts-only`);
    }
  }
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
