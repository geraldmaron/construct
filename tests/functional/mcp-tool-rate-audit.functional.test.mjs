/**
 * tests/functional/mcp-tool-rate-audit.functional.test.mjs
 *
 * Drives the real construct MCP
 * server (lib/mcp/server.mjs) as a subprocess over stdio — the same path a real
 * host uses — and proves two properties the CallToolRequestSchema handler adds:
 * every call lands a value-free record in the durable audit trail (tool name and
 * safety class only, never call arguments), and a per-tool sliding-window budget
 * (lib/mcp/tool-rate-limit.mjs) rejects a tool once its class budget is exhausted,
 * ahead of the tool's own logic.
 *
 * Isolation: CONSTRUCT_DOCTOR_ROOT points at a sandboxed tmpdir so the audit
 * trail this test reads can never be the real user's.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = join(REPO_ROOT, 'lib', 'mcp', 'server.mjs');

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'mcp-rate-audit-'));
  const HOME = join(root, 'HOME');
  const project = join(root, 'project');
  const doctorRoot = join(root, 'doctor');
  mkdirSync(join(HOME, '.construct'), { recursive: true });
  mkdirSync(join(project, '.construct'), { recursive: true });
  mkdirSync(doctorRoot, { recursive: true });
  return {
    root, HOME, project, doctorRoot,
    auditFile: join(doctorRoot, 'audit-trail.jsonl'),
    cleanup() { rmTmpDir(root); },
  };
}

async function connect(env, extraEnv = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    cwd: env.project,
    env: {
      ...process.env,
      HOME: env.HOME,
      CONSTRUCT_HOME_OVERRIDE: env.HOME,
      CONSTRUCT_DEV_PATH: REPO_ROOT,
      CONSTRUCT_DOCTOR_ROOT: env.doctorRoot,
      ...extraEnv,
    },
  });
  const client = new Client({ name: 'mcp-rate-audit-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

function payload(result) {
  const text = result?.content?.find((c) => c.type === 'text')?.text;
  if (text == null) return result;
  try { return JSON.parse(text); } catch { return text; }
}

function readAuditRows(env) {
  let raw;
  try { raw = readFileSync(env.auditFile, 'utf8'); } catch { return []; }
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('CallTool logs a value-free audit record and never leaks call arguments', async (t) => {
  const env = sandbox();
  t.after(env.cleanup);
  const client = await connect(env);
  t.after(() => client.close());

  const SENTINEL_PATH = 'perspectives/engineer';
  await client.callTool({ name: 'get_skill', arguments: { path: SENTINEL_PATH } });

  const rows = readAuditRows(env);
  const record = rows.find((r) => r.tool === 'get_skill');
  assert.ok(record, `no audit record for get_skill: ${JSON.stringify(rows)}`);
  assert.equal(record.agent, 'mcp-server');
  assert.equal(record.target, 'read');
  assert.equal(typeof record.ok, 'boolean');
  assert.equal(typeof record.duration_ms, 'number');

  const serialized = JSON.stringify(record);
  assert.ok(!serialized.includes(SENTINEL_PATH), `audit record leaked the call argument: ${serialized}`);
});

test('CallTool rejects a tool once its safety-class rate budget is exhausted', async (t) => {
  const env = sandbox();
  t.after(env.cleanup);
  const client = await connect(env);
  t.after(() => client.close());

  // storage_reset's class is 'destructive' (budget 5/60s). No confirm/token is
  // passed, so under-budget calls return the tool's own "requires confirm=true"
  // refusal — never a real reset — while a call past the budget must be rejected
  // by the rate limiter before dispatch even runs.

  const results = [];
  for (let i = 0; i < 6; i += 1) {
    results.push(payload(await client.callTool({ name: 'storage_reset', arguments: {} })));
  }

  const underBudget = results.slice(0, 5);
  const overBudget = results[5];

  assert.ok(
    underBudget.every((r) => /confirm=true/.test(r.error || '')),
    `an under-budget call did not reach storage_reset's own refusal: ${JSON.stringify(underBudget)}`,
  );
  assert.match(
    overBudget.error || '',
    /rate-limited/,
    `the 6th destructive-class call was not rate-limited: ${JSON.stringify(overBudget)}`,
  );

  const rows = readAuditRows(env).filter((r) => r.tool === 'storage_reset');
  assert.equal(rows.length, 6, 'every call, including the rejected one, must still be audited');
  assert.equal(rows[5].ok, false, 'the rate-limited call must be recorded as a failure');
});
