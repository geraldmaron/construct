/**
 * tests/host-capabilities.test.mjs — <one-line purpose>
 *
 * <2–6 line summary: what it does, who calls it, key side effects.>
 */
import assert from "node:assert/strict";
import test from "node:test";

import { detectHostCapabilities } from "../lib/host-capabilities.mjs";

test("host capabilities classify full multi-agent support separately from OpenCode subagents", () => {
  const hosts = detectHostCapabilities();
  const names = hosts.map((host) => host.host);

  assert.deepEqual(names, ["Claude Code", "OpenCode", "Codex"]);
  assert.match(hosts.find((host) => host.host === "OpenCode").orchestration, /primary-plus-subagents|plugin-augmented-subagents/);
  assert.equal(hosts.find((host) => host.host === "OpenCode").promptableWorkers, false);
  assert.equal(hosts.find((host) => host.host === "Codex").orchestration, "profile-and-mcp");
});
