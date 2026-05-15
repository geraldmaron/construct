/**
 * tests/broker-check.test.mjs — broker_check MCP tool contract.
 *
 * Pins Tier 1 sub-bead 3 wiring: the tool exposes policyDecision for
 * pre-action queries. Solo mode short-circuits to `brokerActive: false`
 * (no manifest read, no policy enforcement) so agents don't waste
 * tokens consulting an inactive gate. Team / enterprise mode reads
 * agents/role-manifests.json. Every call emits a `tool.called` trace
 * event for audit-trail parity.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { brokerCheck } from '../lib/mcp/tools/skills.mjs';
import { traceDir } from '../lib/worker/trace.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let originalCwd;
let originalEnv;
let tempDir;

beforeEach(() => {
  originalCwd = process.cwd();
  originalEnv = { ...process.env };
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-broker-check-'));
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  process.env = originalEnv;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('brokerCheck', () => {
  it('is a no-op in solo mode (brokerActive=false, allowed=true)', async () => {
    delete process.env.CONSTRUCT_DEPLOYMENT_MODE;
    delete process.env.CONSTRUCT_MCP_BROKER;
    const r = await brokerCheck({ role: 'engineer', tool: 'github', action: 'create_pr' });
    assert.equal(r.brokerActive, false);
    assert.equal(r.allowed, true);
    assert.equal(r.source, 'broker-off');
    assert.match(r.reason, /broker inactive/);
  });

  it('engages in team mode and reads the real role-manifests.json', async () => {
    process.env.CONSTRUCT_DEPLOYMENT_MODE = 'team';
    const r = await brokerCheck({ role: 'engineer', tool: 'git', action: 'commit', risk: 'medium' });
    assert.equal(r.brokerActive, true);
    // engineer manifest has `commit` in approvalRequired
    assert.equal(r.allowed, true);
    assert.equal(r.approvalRequired, true);
    assert.equal(r.source, 'manifest.approvalRequired');
  });

  it('honors CONSTRUCT_MCP_BROKER=on override in solo mode', async () => {
    process.env.CONSTRUCT_DEPLOYMENT_MODE = 'solo';
    process.env.CONSTRUCT_MCP_BROKER = 'on';
    const r = await brokerCheck({ role: 'engineer', tool: 'fs', action: 'read', risk: 'low' });
    assert.equal(r.brokerActive, true);
    assert.equal(r.allowed, true);
    assert.equal(r.approvalRequired, false);
    assert.equal(r.source, 'default');
  });

  it('denies an unknown role in active mode', async () => {
    process.env.CONSTRUCT_DEPLOYMENT_MODE = 'team';
    const r = await brokerCheck({ role: 'imaginary-role', tool: 'fs', action: 'read' });
    assert.equal(r.brokerActive, true);
    assert.equal(r.allowed, false);
    assert.match(r.reason, /no role manifest/);
  });

  it('emits a tool.called trace event with the decision metadata (active mode)', async () => {
    process.env.CONSTRUCT_DEPLOYMENT_MODE = 'team';
    await brokerCheck({ role: 'engineer', tool: 'git', action: 'commit', risk: 'medium', traceId: 'trace-test-1' });
    const dir = traceDir(process.cwd());
    const files = fs.readdirSync(dir);
    const events = fs.readFileSync(path.join(dir, files[0]), 'utf8').trim().split('\n').map(JSON.parse);
    const event = events.find((e) => e.eventType === 'tool.called' && e.traceId === 'trace-test-1');
    assert.ok(event, 'tool.called event was emitted');
    assert.equal(event.metadata.brokerActive, true);
    assert.equal(event.metadata.approvalRequired, true);
    assert.equal(event.metadata.source, 'manifest.approvalRequired');
  });

  it('emits a tool.called trace event even in solo mode (audit-trail parity)', async () => {
    delete process.env.CONSTRUCT_DEPLOYMENT_MODE;
    delete process.env.CONSTRUCT_MCP_BROKER;
    await brokerCheck({ role: 'engineer', tool: 'fs', action: 'read', traceId: 'trace-solo-1' });
    const dir = traceDir(process.cwd());
    const files = fs.readdirSync(dir);
    const events = fs.readFileSync(path.join(dir, files[0]), 'utf8').trim().split('\n').map(JSON.parse);
    const event = events.find((e) => e.eventType === 'tool.called' && e.traceId === 'trace-solo-1');
    assert.ok(event, 'tool.called event was emitted even with broker off');
    assert.equal(event.metadata.brokerActive, false);
    assert.equal(event.metadata.source, 'broker-off');
  });
});
