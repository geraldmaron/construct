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

import {
  findOpenCodeConfigPath,
  getCanonicalOpenCodeConfigPath,
  getOpenCodeConfigDir,
  parseOpenCodeConfigContent,
  readOpenCodeConfig,
  sanitizeOpenCodeConfig,
  writeOpenCodeConfig,
} from "../lib/opencode-config.mjs";

function tempHome(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "construct-opencode-home-"));
  if (t) t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
  return dir;
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

test("writeOpenCodeConfig does not persist legacy construct metadata", (t) => {
  const originalHome = process.env.HOME;
  const home = tempHome(t);
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

test("parseOpenCodeConfigContent accepts JSONC comments and trailing commas", () => {
  const parsed = parseOpenCodeConfigContent(`{
    // comment
    "mcp": {
      "construct-mcp": {
        "type": "local",
      },
    },
  }`);

  assert.deepEqual(parsed, {
    mcp: {
      "construct-mcp": {
        type: "local",
      },
    },
  });
});

test("findOpenCodeConfigPath prefers opencode.jsonc when json does not exist", (t) => {
  const originalHome = process.env.HOME;
  const home = tempHome(t);
  process.env.HOME = home;

  try {
    const configDir = getOpenCodeConfigDir();
    fs.mkdirSync(configDir, { recursive: true });
    const jsoncPath = path.join(configDir, "opencode.jsonc");
    fs.writeFileSync(jsoncPath, '{ "agent": { "construct": {} } }\n');

    assert.equal(findOpenCodeConfigPath(), jsoncPath);
    assert.deepEqual(readOpenCodeConfig().config, { agent: { construct: {} } });
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  }
});

test("findOpenCodeConfigPath falls back to legacy config.json when needed", (t) => {
  const originalHome = process.env.HOME;
  const home = tempHome(t);
  process.env.HOME = home;

  try {
    const configDir = getOpenCodeConfigDir();
    fs.mkdirSync(configDir, { recursive: true });
    const legacyPath = path.join(configDir, "config.json");
    fs.writeFileSync(legacyPath, '{ "mcp": { "legacy": { "type": "remote" } } }\n');

    assert.equal(findOpenCodeConfigPath(), legacyPath);
    assert.deepEqual(readOpenCodeConfig().config, {
      mcp: { legacy: { type: "remote" } },
    });
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  }
});
