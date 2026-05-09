/**
 * opencode-config.test.mjs — OpenCode config read/write safety.
 *
 * Covers migration away from legacy Construct-owned top-level metadata that
 * OpenCode's strict config schema rejects.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getCanonicalOpenCodeConfigPath, sanitizeOpenCodeConfig, writeOpenCodeConfig } from "../lib/opencode-config.mjs";

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "construct-opencode-home-"));
}

test("sanitizeOpenCodeConfig removes legacy top-level construct metadata", () => {
  const config = {
    $schema: "https://opencode.ai/config.json",
    construct: { disabledSkills: ["swiftui-patterns"] },
    agent: { construct: { mode: "all" } },
    mcp: { memory: { type: "remote", url: "http://127.0.0.1:8765/" } },
  };

  assert.deepEqual(sanitizeOpenCodeConfig(config), {
    $schema: "https://opencode.ai/config.json",
    agent: { construct: { mode: "all" } },
    mcp: { memory: { type: "remote", url: "http://127.0.0.1:8765/" } },
  });
});

test("writeOpenCodeConfig does not persist legacy construct metadata", () => {
  const originalHome = process.env.HOME;
  const home = tempHome();
  process.env.HOME = home;

  try {
    const written = writeOpenCodeConfig({
      $schema: "https://opencode.ai/config.json",
      construct: { disabledSkills: ["frontend-slides"] },
      agent: {},
      mcp: {},
    });

    assert.equal(written, getCanonicalOpenCodeConfigPath());
    const saved = JSON.parse(fs.readFileSync(written, "utf8"));
    assert.equal(saved.construct, undefined);
    assert.deepEqual(saved.agent, {});
    assert.deepEqual(saved.mcp, {});
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }
});
