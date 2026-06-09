/**
 * mcp-ingest-resilience.functional.test.mjs — isolated MCP ingest failure repro.
 *
 * Reproduces the conditions behind the "Cannot read properties of undefined
 * (reading 'invoke')" report: the ingest_document MCP tool hitting a broken/
 * stalled docling extractor. Spawns the REAL MCP server over stdio in a sterile
 * sandbox whose docling venv is a stub (a python that exits non-zero), recorded
 * via the install marker so provisioning never runs and the network is never
 * touched. The tool must return a clean, bounded result — the legacy-extractor
 * fallback — never hang the server and never surface an undefined-property crash.
 */
import test from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const DOCLING_PIN = "2.45.0";

function makeSandbox() {
  const root = mkdtempSync(join(tmpdir(), "mcp-ingest-"));
  // Stub docling venv: a python that exits non-zero, recorded in the marker so
  // ensureDoclingVenv returns it without provisioning (no uv, no network).
  const venvBin = join(root, ".cx", "runtime", "docling", ".venv", "bin");
  mkdirSync(venvBin, { recursive: true });
  const py = join(venvBin, "python");
  writeFileSync(py, "#!/bin/sh\nexit 1\n");
  chmodSync(py, 0o755);
  writeFileSync(
    join(root, ".cx", "runtime", "docling", ".install-marker.json"),
    JSON.stringify({ doclingVersion: DOCLING_PIN, pythonBin: py }),
  );
  // A docling-format input (.rtf is routed to docling, and the legacy extractor
  // also handles it) so the fallback produces real text.
  const rtf = join(root, "sample.rtf");
  writeFileSync(rtf, "{\\rtf1\\ansi Hello from a sterile RTF document.}");
  return { root, rtf };
}

async function withClient(root, fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(repoRoot, "lib", "mcp", "server.mjs")],
    cwd: root,
    env: {
      ...process.env,
      HOME: root,
      CONSTRUCT_EMBEDDING_MODEL: "hashing",
      CONSTRUCT_EMBEDDING_DISABLE_LOCAL: "1",
      CONSTRUCT_DOCLING_TIMEOUT_MS: "2000",
      CONSTRUCT_MCP_TOOL_TIMEOUT_MS: "30000",
    },
  });
  const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
  await client.connect(transport);
  try { return await fn(client); } finally { await client.close(); }
}

test("ingest_document with a broken docling extractor returns the legacy fallback, never hangs or crashes on 'invoke'", async () => {
  const { root, rtf } = makeSandbox();
  try {
    const parsed = await withClient(root, async (client) => {
      const res = await client.callTool({ name: "ingest_document", arguments: { file_path: rtf, cwd: root } });
      const text = res?.content?.[0]?.text ?? "";
      assert.ok(text, "tool returned content");
      assert.doesNotMatch(text, /reading 'invoke'|Cannot read properties of undefined/, "no undefined-property crash");
      return JSON.parse(text);
    });

    assert.equal(parsed.status, "ok", `ingest should complete via fallback, got: ${JSON.stringify(parsed).slice(0, 300)}`);
    const file = parsed.files?.[0];
    assert.ok(file, "a file result is present");
    assert.ok(file.droppedInfo.some((d) => d.kind === "docling-fallback"), "fallback to the legacy extractor is recorded");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("server stays responsive after the failing ingest (tools/list still answers)", async () => {
  const { root, rtf } = makeSandbox();
  try {
    await withClient(root, async (client) => {
      await client.callTool({ name: "ingest_document", arguments: { file_path: rtf, cwd: root } });
      const tools = await client.listTools();
      assert.ok(tools.tools.some((t) => t.name === "ingest_document"), "server answers tools/list after the failing call");
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
