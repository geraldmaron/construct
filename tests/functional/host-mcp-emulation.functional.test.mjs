/**
 * tests/functional/host-mcp-emulation.functional.test.mjs
 *
 * Sterile, no-LLM emulation of how a host (Claude Code, VS Code, Codex, OpenCode,
 * Cursor) actually drives Construct: connect to the real construct MCP server
 * (lib/mcp/server.mjs) over stdio as an MCP client and call the contract tools,
 * proving skills/templates/specialist-routing/the loop machinery are exercised —
 * the deterministic half of "are skills and specialists being used?". Specialist
 * prompts (which need a real model) are out of scope here; the gated real-LLM
 * layer covers artifact quality.
 *
 * Auditability: get_skill must record the load in the doctor-root
 * skill-calls.jsonl (under the isolated HOME), so the suite proves a skill was
 * loaded, not just returned.
 *
 * Isolation: own HOME + CX_HOME_OVERRIDE + project tmpdir; the server resolves
 * skills/templates from the repo (ROOT_DIR) and writes telemetry into the sandbox.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { doctorRoot } from '../../lib/config/xdg.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = join(REPO_ROOT, 'lib', 'mcp', 'server.mjs');

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'host-mcp-'));
  const HOME = join(root, 'HOME');
  const project = join(root, 'project');
  mkdirSync(join(HOME, '.cx'), { recursive: true });
  mkdirSync(join(project, '.cx'), { recursive: true });
  return { root, HOME, project, cleanup() { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } };
}

// The host spawns the server as a subprocess and speaks MCP over its stdio. The
// sandbox HOME/CX_HOME_OVERRIDE route telemetry into the tmpdir; cwd is the
// project so project-scoped resolution matches a real session.
async function connect(env) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    cwd: env.project,
    env: { ...process.env, HOME: env.HOME, CX_HOME_OVERRIDE: env.HOME, CONSTRUCT_DEV_PATH: REPO_ROOT },
  });
  const client = new Client({ name: 'host-emulation-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

// construct tools return their payload as JSON text content; parse it back.
function payload(result) {
  const text = result?.content?.find((c) => c.type === 'text')?.text;
  if (text == null) return result;
  try { return JSON.parse(text); } catch { return text; }
}

test('a host drives construct over MCP: skills, templates, and specialist routing', async (t) => {
  const env = sandbox();
  t.after(() => env.cleanup());
  const client = await connect(env);
  t.after(() => client.close());

  // The host first discovers tools — the contract surface must be reachable. Core
  // tools are flat; long-tail tools stay reachable through the construct_call
  // gateway's enum, not as flat entries.
  const { tools } = await client.listTools();
  const names = new Set(tools.map((x) => x.name));
  const gateway = tools.find((x) => x.name === 'call');
  const reachable = new Set(gateway?.inputSchema?.properties?.tool?.enum ?? []);
  for (const core of ['get_skill', 'orchestration_policy']) {
    assert.ok(names.has(core), `MCP server must expose core tool ${core} flat`);
  }
  assert.ok(names.has('get_template'), 'get_template is a flat core tool');
  for (const deferred of ['list_skills', 'agent_contract']) {
    assert.ok(reachable.has(deferred), `MCP server must keep ${deferred} reachable via the call gateway`);
  }

  // Skills are discoverable + loadable, and the load is audited.
  const skills = payload(await client.callTool({ name: 'list_skills', arguments: {} }));
  assert.ok(JSON.stringify(skills).length > 2, 'list_skills returns a non-empty catalog');

  const skill = payload(await client.callTool({ name: 'get_skill', arguments: { path: 'roles/architect' } }));
  assert.ok(skill.content && skill.content.length > 0, 'get_skill returns content');
  assert.ok(skill.content.trimStart().startsWith('---'), 'skill carries frontmatter');
  const onDisk = readFileSync(join(REPO_ROOT, 'skills', 'roles', 'architect.md'), 'utf8');
  assert.equal(skill.content, onDisk, 'loaded skill matches the file on disk');

  // Audit: the skill load is recorded under the isolated HOME (proves "used").
  const skillLog = join(doctorRoot(env.HOME), 'skill-calls.jsonl');
  assert.ok(existsSync(skillLog), 'skill load is recorded in the doctor-root skill-calls.jsonl');
  assert.match(readFileSync(skillLog, 'utf8'), /roles\/architect/, 'the loaded skill id appears in the audit log');

  // Templates are resolvable by name (the skeleton a PRD/ADR is authored from).
  const tmpl = payload(await client.callTool({ name: 'get_template', arguments: { name: 'prd' } }));
  assert.ok(tmpl.content && tmpl.content.length > 0, 'get_template returns the prd skeleton');
  assert.ok(/project-override|shipped-default/.test(tmpl.source || ''), 'template reports its source');

  // Specialist routing: a substantial, contract-introducing PRD request must
  // classify as orchestrated and name a specialist chain — proof the loop is
  // wired even without running a model.
  const policy = payload(await client.callTool({
    name: 'orchestration_policy',
    arguments: { request: 'Write a PRD for a new multi-tenant billing service with an external API contract.', fileCount: 12, moduleCount: 4, introducesContract: true },
  }));
  const track = policy.track || policy.intent?.track;
  assert.ok(typeof track === 'string' && track.length > 0, 'orchestration_policy returns a track');
  const specialists = policy.specialists || policy.specialistSequence || policy.dispatch || [];
  assert.ok(JSON.stringify(specialists).length > 2, 'orchestration_policy names a specialist sequence');
});

test('a trivial request does not over-orchestrate (track is not forced to orchestrated)', async (t) => {
  const env = sandbox();
  t.after(() => env.cleanup());
  const client = await connect(env);
  t.after(() => client.close());

  const policy = payload(await client.callTool({
    name: 'orchestration_policy',
    arguments: { request: 'Fix a typo in the README.', fileCount: 1, moduleCount: 1, introducesContract: false },
  }));
  const track = policy.track || policy.intent?.track || '';
  assert.notEqual(track, 'orchestrated', 'a one-file typo must not be classified orchestrated');
});

test('a host can execute a research-shaped request through orchestration_run after policy classification', async (t) => {
  const env = sandbox();
  t.after(() => env.cleanup());
  const client = await connect(env);
  t.after(() => client.close());

  const policy = payload(await client.callTool({
    name: 'orchestration_policy',
    arguments: { request: 'compare oidc vs saml', fileCount: 1, moduleCount: 1, introducesContract: false },
  }));
  assert.equal(policy.track, 'focused');
  assert.equal(policy.suggestedWorkflowType, 'research-synthesis');
  assert.equal(policy.researchExecutionPolicy?.mode, 'evidence-first');

  const run = payload(await client.callTool({
    name: 'orchestration_run',
    arguments: {
      request: 'compare oidc vs saml',
      workflow_type: policy.suggestedWorkflowType,
      file_count: 1,
      module_count: 1,
      wait: true,
      worker_backend: 'inline',
    },
  }));
  assert.equal(run.intent, 'research');
  assert.equal(run.track, 'focused');
  assert.equal(run.suggestedWorkflowType, 'research-synthesis');
  assert.deepEqual(run.specialists, ['cx-researcher']);
  assert.equal(run.researchExecutionPolicy?.mode, 'evidence-first');
});
