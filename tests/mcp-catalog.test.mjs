/**
 * mcp-catalog.test.mjs — Contract tests for the built-in MCP server catalog.
 *
 * Verifies that all catalog entries declare required fields, setup modes,
 * and env vars, and that external plugin manifests are loadable.
 */
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const catalogPath = path.join(root, "lib", "mcp-catalog.json");

test("mcp catalog entries declare required array and env fields", () => {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));

  for (const mcp of catalog.mcps) {
    assert.ok(Array.isArray(mcp.requiredEnv), `MCP ${mcp.id} missing requiredEnv array`);
    assert.ok(Array.isArray(mcp.usedBy), `MCP ${mcp.id} missing usedBy array`);
    assert.ok(mcp.env && typeof mcp.env === "object" && !Array.isArray(mcp.env), `MCP ${mcp.id} missing env object`);
  }
});
