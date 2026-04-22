import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { initPluginManifest, loadPluginRegistry, validatePluginManifest } from "../lib/plugin-registry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("validatePluginManifest accepts a minimal valid plugin manifest", () => {
  const result = validatePluginManifest({
    version: 1,
    plugins: [
      {
        id: "acme",
        name: "Acme",
        version: "0.1.0",
        description: "Acme plugin",
        capabilities: ["mcp"],
        mcps: [
          {
            id: "acme-search",
            name: "Acme Search",
            category: "integration",
            description: "Search Acme",
            command: "npx",
            args: ["-y", "@acme/search-mcp"],
            env: {},
            requiredEnv: [],
            usedBy: ["construct"],
          },
        ],
      },
    ],
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("loadPluginRegistry merges external manifests with built-ins", () => {
  const cwd = tempDir("construct-plugin-cwd-");
  const home = tempDir("construct-plugin-home-");
  const pluginDir = path.join(cwd, ".cx", "plugins");
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, "acme.json"), JSON.stringify({
    version: 1,
    plugins: [
      {
        id: "acme",
        name: "Acme",
        version: "0.1.0",
        description: "Acme plugin",
        capabilities: ["mcp"],
        mcps: [
          {
            id: "acme-search",
            name: "Acme Search",
            category: "integration",
            description: "Search Acme",
            command: "npx",
            args: ["-y", "@acme/search-mcp"],
            env: {},
            requiredEnv: [],
            setupModes: ["manual"],
            usedBy: ["construct"],
            degradedMessage: "Acme unavailable.",
          },
        ],
      },
    ],
  }, null, 2));

  const registry = loadPluginRegistry({ cwd, homeDir: home, rootDir: root });
  const plugin = registry.plugins.find((entry) => entry.id === "acme");
  const mcp = registry.mcps.find((entry) => entry.id === "acme-search");

  assert.equal(registry.valid, true);
  assert.ok(plugin);
  assert.ok(mcp);
  assert.equal(mcp.pluginId, "acme");
});

test("loadPluginRegistry reports duplicate MCP ids across manifests", () => {
  const cwd = tempDir("construct-plugin-dup-cwd-");
  const home = tempDir("construct-plugin-dup-home-");
  const pluginDir = path.join(cwd, ".cx", "plugins");
  fs.mkdirSync(pluginDir, { recursive: true });

  for (const file of ["one.json", "two.json"]) {
    fs.writeFileSync(path.join(pluginDir, file), JSON.stringify({
      version: 1,
      plugins: [
        {
          id: file.replace(".json", ""),
          name: file,
          version: "0.1.0",
          description: "duplicate test",
          mcps: [
            {
              id: "shared-id",
              name: "Shared",
              category: "integration",
              description: "Shared",
              command: "npx",
              args: ["-y", "@shared/mcp"],
              env: {},
              requiredEnv: [],
              usedBy: ["construct"],
            },
          ],
        },
      ],
    }, null, 2));
  }

  const registry = loadPluginRegistry({ cwd, homeDir: home, rootDir: root });
  assert.equal(registry.valid, false);
  assert.match(registry.errors.join("\n"), /duplicate MCP id shared-id/);
});

test("initPluginManifest creates a starter plugin manifest", () => {
  const cwd = tempDir("construct-plugin-init-cwd-");
  const filePath = initPluginManifest("starter", { cwd });
  const manifest = JSON.parse(fs.readFileSync(filePath, "utf8"));

  assert.equal(fs.existsSync(filePath), true);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.plugins[0].id, "starter");
});
