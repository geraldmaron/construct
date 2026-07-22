/**
 * capabilities.test.mjs — platform capability registry data contract (ADR-0033).
 *
 * Locks the values sync and init derive from platforms/capabilities.json so a
 * registry edit that changes host behavior must update this test deliberately.
 * Also asserts the loader fails loud on an unknown host rather than falling
 * through to a default — the silent fall-through the registry exists to remove.
 */
import test from "node:test";
import assert from "node:assert";
import {
  HOST_KEYS,
  loadCapabilities,
  getCapability,
  hasNativeSubagents,
  displayNameToKey,
  globalHookAllowlist,
  globalMcpAllowlist,
} from "../../lib/platforms/capabilities.mjs";

test("HOST_KEYS is the canonical six-host enumeration derived from the registry", () => {
  assert.deepEqual(HOST_KEYS, ["claude", "codex", "copilot", "opencode", "vscode", "cursor"]);
});

test("every host declares a complete capability entry", () => {
  for (const key of HOST_KEYS) {
    const cap = getCapability(key);
    assert.equal(typeof cap.displayName, "string");
    assert.equal(typeof cap.hasNativeSubagents, "boolean");
    assert.equal(typeof cap.instructionsOnly, "boolean");
    assert.equal(typeof cap.supportsMcp, "boolean");
    assert.ok(["json", "toml", "markdown"].includes(cap.configFormat));
    assert.ok(["modelfile", "none"].includes(cap.localModelProvisioning));
    assert.equal(typeof cap.hooks.supported, "boolean");
    assert.ok(Array.isArray(cap.hooks.globalAllowlist));
    assert.ok(Array.isArray(cap.globalMcpAllowlist));
  }
});

test("native-subagent hosts are exactly opencode, vscode, cursor", () => {
  assert.equal(hasNativeSubagents("opencode"), true);
  assert.equal(hasNativeSubagents("vscode"), true);
  assert.equal(hasNativeSubagents("cursor"), true);
  assert.equal(hasNativeSubagents("claude"), false);
  assert.equal(hasNativeSubagents("codex"), false);
  assert.equal(hasNativeSubagents("copilot"), false);
});

test("displayName-to-key map covers every host", () => {
  assert.deepEqual(displayNameToKey(), {
    "Claude Code": "claude",
    "Codex": "codex",
    "Copilot": "copilot",
    "OpenCode": "opencode",
    "VS Code": "vscode",
    "Cursor": "cursor",
  });
});

test("only claude has Construct-wired hooks (hooks.supported=true)", () => {
  assert.equal(getCapability("claude").hooks.supported, true);
  for (const key of HOST_KEYS.filter((k) => k !== "claude")) {
    assert.equal(
      getCapability(key).hooks.supported,
      false,
      `${key} must remain hooks.supported=false — Construct declines unsafe host hook parity`,
    );
  }
});

test("claude carries the safety-only global hook + mcp allowlists; others carry none", () => {
  assert.deepEqual([...globalHookAllowlist("claude")].sort(), [
    "post:edit:json-validate",
    "post:edit:scan-secrets",
    "pre:bash:block-no-verify",
    "pre:bash:guard-dangerous",
    "pre:edit-guard",
    "pre:edit:config-protection",
  ]);
  assert.deepEqual([...globalMcpAllowlist("claude")], ["context7"]);
  assert.equal(globalHookAllowlist("opencode").size, 0);
  assert.equal(globalMcpAllowlist("codex").size, 0);
});

test("only opencode provisions local-model context; only copilot is instructions-only", () => {
  assert.equal(getCapability("opencode").localModelProvisioning, "modelfile");
  for (const key of HOST_KEYS.filter((k) => k !== "opencode")) {
    assert.equal(getCapability(key).localModelProvisioning, "none");
  }
  assert.equal(getCapability("copilot").instructionsOnly, true);
  assert.equal(getCapability("copilot").supportsMcp, false);
});

test("an unknown host fails loud rather than returning a default", () => {
  assert.throws(() => getCapability("notahost"), /unknown host 'notahost'/);
});

test("the registry validates on load", () => {
  const reg = loadCapabilities();
  assert.equal(reg.version, 1);
  assert.equal(Object.keys(reg.hosts).length, 6);
});
