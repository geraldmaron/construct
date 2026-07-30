/**
 * mcp-ingest-resilience.functional.test.mjs — isolated MCP ingest failure repro.
 *
 * Reproduces the conditions behind the "Cannot read properties of undefined
 * (reading 'invoke')" report: the ingest_document MCP tool hitting a broken/
 * stalled docling extractor. Spawns the REAL MCP server over stdio in a sterile
 * sandbox whose docling venv is a stub (a python that exits non-zero), recorded
 * via the install marker so provisioning never runs and the network is never
 * touched. The tool must return a clean, bounded result — recoverable unsupported
 * when docling cannot run — never hang the server and never surface an undefined-
 * property crash.
 *
 * @capability ingest.docling
 *
 * The docling venv resolves through the machine-shared runtime root
 * never keyed by project: the sandbox's
 * HOME == root, so the stub lands at root/.construct/runtime/docling/ — the
 * same place the running server resolves it to, regardless of its cwd.
 */
import test from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { rmTmpDir } from '../helpers/cleanup.mjs';

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const DOCLING_PIN = "2.45.0";

function makeSandbox() {
  const root = mkdtempSync(join(tmpdir(), "mcp-ingest-"));
  // Stub docling venv: a python that exits non-zero, recorded in the marker so
  // ensureDoclingVenv returns it without provisioning (no uv, no network).
  const runtimeDir = join(root, ".construct", "runtime", "docling");
  const venvBin = join(runtimeDir, ".venv", "bin");
  mkdirSync(venvBin, { recursive: true });
  const py = join(venvBin, "python");
  writeFileSync(py, "#!/bin/sh\nexit 1\n");
  chmodSync(py, 0o755);
  writeFileSync(
    join(runtimeDir, ".install-marker.json"),
    JSON.stringify({ doclingVersion: DOCLING_PIN, pythonBin: py }),
  );
  // Office formats with no lightweight parser route through docling-local when the
  // install marker is present; a broken venv must fail closed with a recoverable
  // result instead of hanging or surfacing an undefined-property crash.
  const pptx = join(root, "sample.pptx");
  writeFileSync(pptx, "fake pptx bytes");
  return { root, pptx };
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

test("ingest_document with a broken docling extractor returns a bounded recoverable result, never hangs or crashes on 'invoke'", async () => {
  const { root, pptx } = makeSandbox();
  try {
    const parsed = await withClient(root, async (client) => {
      const res = await client.callTool({ name: "ingest_document", arguments: { file_path: pptx, cwd: root } });
      const text = res?.content?.[0]?.text ?? "";
      assert.ok(text, "tool returned content");
      assert.doesNotMatch(text, /reading 'invoke'|Cannot read properties of undefined/, "no undefined-property crash");
      return JSON.parse(text);
    });

    assert.equal(parsed.status, "ok", `ingest should complete with a bounded result, got: ${JSON.stringify(parsed).slice(0, 300)}`);
    const file = parsed.files?.[0];
    assert.ok(file, "a file result is present");
    assert.equal(file.unsupported, true, "docling failure surfaces as recoverable unsupported, not a hang");
    assert.ok(
      file.droppedInfo.some((d) => d.recoverable && /docling|Docling|lightweight parser/i.test(d.reason)),
      "recoverable docling-unavailable drop is recorded",
    );
  } finally {
    rmTmpDir(root);
  }
});

test("server stays responsive after the failing ingest (tools/list still answers)", async () => {
  const { root, pptx } = makeSandbox();
  try {
    await withClient(root, async (client) => {
      await client.callTool({ name: "ingest_document", arguments: { file_path: pptx, cwd: root } });
      const tools = await client.listTools();
      // ingest_document is now reachable via the construct_call gateway, not the
      // flat surface; assert tools/list still answers with the exposed core.
      assert.ok(tools.tools.some((t) => t.name === "call"), "server answers tools/list after the failing call");
    });
  } finally {
    rmTmpDir(root);
  }
});
