/**
 * tests/orchestration-route-path.test.mjs — routePath payload end-to-end (construct-d1r7.15).
 *
 * routeRequest already computed teamRouting, contractChain, dispatchReasons,
 * and proactive triggers separately; routePath packages them into one shared
 * shape — teamPath, specialistSequence, contractChain, sourcePolicy,
 * rationale — and this file pins that the SAME payload (not a re-derived
 * approximation) reaches every surface that quotes a route: the direct
 * routeRequest() return, the orchestration_policy MCP response and its
 * handoffPacket, the orchestration_run MCP response (shapeRun) and CLI JSON
 * (hostAdapterMetadata), and the durable planning trace event.
 *
 * Uses real request strings that classify to a real orchestrated chain
 * (mirrors tests/orchestration-policy.test.mjs's "build this feature end to
 * end and ship it" fixture) rather than mocked routing, so a passing
 * assertion proves routePath carries real routing data end-to-end.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { routeRequest, buildConstructToOrchestratorPacket } from '../lib/orchestration-policy.mjs';
import { orchestrationPolicy } from '../lib/mcp/tools/skills.mjs';
import { runOrchestration, planRun, hostAdapterMetadata } from '../lib/orchestration/runtime.mjs';
import { shapeRun } from '../lib/mcp/tools/orchestration-run.mjs';
import { traceDir } from '../lib/worker/trace.mjs';

const MODEL = 'anthropic/claude-sonnet-4-6';
const ENV = { CX_MODEL_REASONING: MODEL, CX_MODEL_STANDARD: MODEL, CX_MODEL_FAST: MODEL };
const REQUEST = 'build this feature end to end and ship it';

const dirs = [];
function project() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-route-path-'));
  dirs.push(cwd);
  return cwd;
}
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

// planRun/runOrchestration resolve their state root through CX_HOME_OVERRIDE
// (ADR-0066), same isolation tests/orchestration-runtime.test.mjs applies —
// without it these runs would write into the real developer machine's
// ~/.construct/projects/.

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-route-path-home-'));
const prevHomeOverride = process.env.CX_HOME_OVERRIDE;
process.env.CX_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
});

function assertRoutePathShape(routePath, route) {
  assert.ok(routePath, 'routePath present');
  assert.ok(Array.isArray(routePath.teamPath) && routePath.teamPath.length > 0, 'teamPath is a non-empty array');
  assert.deepEqual(routePath.specialistSequence, route.displaySpecialists, 'specialistSequence mirrors displaySpecialists');
  assert.equal(routePath.contractChain, route.contractChain, 'contractChain is the same array resolveContractChain produced, not a copy');
  assert.equal(routePath.sourcePolicy.intentClassification, route.intent);
  assert.ok(Array.isArray(routePath.sourcePolicy.watchConditionTriggers));
  assert.equal(typeof routePath.rationale, 'string');
  assert.match(routePath.rationale, new RegExp(`intent=${route.intent}`));
}

test('routeRequest returns a real, non-empty routePath for an orchestrated request', () => {
  const route = routeRequest({ request: REQUEST, fileCount: 4, moduleCount: 2 });
  assertRoutePathShape(route.routePath, route);
  assert.ok(route.routePath.teamPath.includes('engineering-team'), 'implementation intent routes through engineering-team');
});

test('buildConstructToOrchestratorPacket (the construct→orchestrator handoff) carries routePath', () => {
  const route = routeRequest({ request: REQUEST, fileCount: 4, moduleCount: 2 });
  const packet = buildConstructToOrchestratorPacket({ request: REQUEST, route, goal: REQUEST });
  assert.ok(packet, 'non-immediate track returns a packet');
  assert.equal(packet.routePath, route.routePath, 'handoff packet reuses the same routePath object routeRequest computed');
});

test('orchestrationPolicy MCP response surfaces routePath directly and on its handoffPacket', async () => {
  const result = await orchestrationPolicy({ request: REQUEST, fileCount: 4, moduleCount: 2 });
  assertRoutePathShape(result.routePath, result);
  assert.ok(result.handoffPacket?.routePath, 'handoffPacket also carries routePath');
  assert.equal(result.handoffPacket.routePath.rationale, result.routePath.rationale);
});

test('orchestration_run: shapeRun and CLI hostAdapterMetadata both surface routePath from the same plan', async () => {
  const cwd = project();
  const run = await runOrchestration(
    { request: REQUEST, requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2 },
    { env: ENV, cwd },
  );
  const shaped = shapeRun(run);
  assert.ok(shaped.routePath, 'shapeRun (MCP orchestration_run / orchestration_status response) carries routePath');
  assert.ok(shaped.routePath.teamPath.length > 0);
  assert.ok(shaped.routePath.specialistSequence.length > 0);
  assert.equal(typeof shaped.routePath.rationale, 'string');
  assert.match(shaped.routePath.rationale, /intent=/);

  const meta = hostAdapterMetadata(run);
  assert.deepEqual(meta.routePath, run.plan.routePath, 'CLI --json (hostAdapterMetadata) surfaces the same routePath persisted on the run');
  assert.deepEqual(meta.routePath, shaped.routePath, 'MCP and CLI JSON report the identical routePath for one run');
});

test('planRun preserves routePath in the durable planning trace event', async () => {
  const cwd = project();
  const run = await planRun(
    { request: REQUEST, requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2 },
    { env: ENV, cwd },
  );
  assert.ok(run.plan.routePath, 'run.plan carries routePath');

  const shard = `${new Date().toISOString().slice(0, 10)}.jsonl`;
  const shardPath = path.join(traceDir(cwd), shard);
  assert.ok(fs.existsSync(shardPath), `trace shard exists at ${shardPath}`);
  const lines = fs.readFileSync(shardPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const created = lines.find((e) => e.eventType === 'task_graph.created' && e.metadata?.runId === run.runId);
  assert.ok(created, 'task_graph.created trace event recorded for this run');
  assert.deepEqual(created.metadata.routePath, run.plan.routePath, 'the persisted trace event carries the exact routePath the run was planned with');
});
