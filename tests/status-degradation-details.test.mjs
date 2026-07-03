/**
 * tests/status-degradation-details.test.mjs — Unit tests for degradationDetails in buildStatus.
 *
 * Covers:
 *   1. buildStatus with a mock .cx/degradation.jsonl → degradationDetails includes all records.
 *   2. buildStatus with no degradation.jsonl → degradationDetails is an empty array.
 *   3. formatStatusReport with degradation details → emits the "Degradation details:" section.
 *
 * Bead: construct-9oi4.13.2 — LMCP-M2
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { buildStatus, formatStatusReport } from '../lib/status.mjs';
import { tempDir } from './helpers.mjs';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

/**
 * Build the minimal file scaffold required by buildStatus. Only the files
 * that buildStatus actually reads synchronously are included here; optional
 * integrations are omitted so the test doesn't need network access.
 */
async function createMinimalFixture({ degradationLines = null } = {}) {
  const rootDir = tempDir('construct-degradation-root-');
  const homeDir = tempDir('construct-degradation-home-');
  const cwd = tempDir('construct-degradation-cwd-');

  // package.json — required by buildStatus
  writeJson(path.join(rootDir, 'package.json'), { name: 'construct', version: '0.0.1-test' });

  // agents/registry.json — required by loadRegistry
  writeJson(path.join(rootDir, 'agents', 'registry.json'), {
    models: {
      reasoning: { primary: 'claude-opus-4-1-20250805' },
      standard: { primary: 'claude-3-5-sonnet-20241022' },
      fast: { primary: 'claude-3-5-haiku-20241022' },
    },
    agents: [],
  });

  // .env — required by loadConstructEnv
  writeText(path.join(rootDir, '.env'), 'MEMORY_PORT=8765\nBRIDGE_PORT=5173\n');

  // settings.json — read for hooks / mcpServers
  writeJson(path.join(homeDir, '.claude', 'settings.json'), { mcpServers: {}, hooks: {} });

  // .cx/context.json — read by inspectContextState
  writeJson(path.join(cwd, '.cx', 'context.json'), {
    format: 'json',
    savedAt: new Date().toISOString(),
    contextSummary: 'test',
    markdown: '# test\n',
    activeWork: [],
  });

  // Optionally write the degradation.jsonl file
  if (degradationLines !== null) {
    const cxDir = path.join(cwd, '.cx');
    fs.mkdirSync(cxDir, { recursive: true });
    fs.writeFileSync(
      path.join(cxDir, 'degradation.jsonl'),
      degradationLines.map((r) => JSON.stringify(r)).join('\n') + '\n',
    );
  }

  return { rootDir, homeDir, cwd };
}

// A no-op probeService so tests don't make network calls.
async function silentProbeService(_service) {
  return { status: 'unavailable', message: 'test stub' };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('buildStatus: degradationDetails is empty when no degradation.jsonl exists', async () => {
  const { rootDir, homeDir, cwd } = await createMinimalFixture();

  const status = await buildStatus({
    rootDir,
    homeDir,
    cwd,
    env: {},
    probeService: silentProbeService,
  });

  assert.ok(Array.isArray(status.degradationDetails), 'degradationDetails should be an array');
  assert.equal(status.degradationDetails.length, 0, 'degradationDetails should be empty when no file');
});

test('buildStatus: degradationDetails includes records from .cx/degradation.jsonl', async () => {
  const degradationLines = [
    {
      ts: '2026-07-03T10:00:00.000Z',
      mode: 'team',
      subsystem: 'postgres-queue',
      degradedOk: true,
    },
  ];

  const { rootDir, homeDir, cwd } = await createMinimalFixture({ degradationLines });

  const status = await buildStatus({
    rootDir,
    homeDir,
    cwd,
    env: {},
    probeService: silentProbeService,
  });

  assert.ok(Array.isArray(status.degradationDetails), 'degradationDetails should be an array');
  assert.equal(status.degradationDetails.length, 1, 'should have one degradation record');

  const record = status.degradationDetails[0];
  assert.equal(record.subsystem, 'postgres-queue');
  assert.ok(typeof record.declared === 'string', 'declared should be a string');
  assert.ok(typeof record.actual === 'string', 'actual should be a string');
  assert.ok(typeof record.reason === 'string', 'reason should be a string');
  assert.match(record.reason, /postgres-queue/, 'reason should mention the subsystem');
});

test('buildStatus: degradationDetails includes multiple records', async () => {
  const degradationLines = [
    { ts: '2026-07-03T10:00:00.000Z', mode: 'team', subsystem: 'postgres-queue', degradedOk: true },
    { ts: '2026-07-03T10:01:00.000Z', mode: 'team', subsystem: 'shared-memory', degradedOk: true },
  ];

  const { rootDir, homeDir, cwd } = await createMinimalFixture({ degradationLines });

  const status = await buildStatus({
    rootDir,
    homeDir,
    cwd,
    env: {},
    probeService: silentProbeService,
  });

  assert.equal(status.degradationDetails.length, 2, 'should have two degradation records');
  const subsystems = status.degradationDetails.map((r) => r.subsystem);
  assert.ok(subsystems.includes('postgres-queue'));
  assert.ok(subsystems.includes('shared-memory'));
});

test('buildStatus: degradation record with explicit declared/actual/reason fields', async () => {
  const degradationLines = [
    {
      ts: '2026-07-03T10:00:00.000Z',
      mode: 'team',
      subsystem: 'intake-queue',
      declared: 'postgres',
      actual: 'git',
      reason: 'CONSTRUCT_DEGRADED_OK=postgres-queue set',
      degradedOk: true,
    },
  ];

  const { rootDir, homeDir, cwd } = await createMinimalFixture({ degradationLines });

  const status = await buildStatus({
    rootDir,
    homeDir,
    cwd,
    env: {},
    probeService: silentProbeService,
  });

  const record = status.degradationDetails[0];
  assert.equal(record.subsystem, 'intake-queue');
  assert.equal(record.declared, 'postgres');
  assert.equal(record.actual, 'git');
  assert.equal(record.reason, 'CONSTRUCT_DEGRADED_OK=postgres-queue set');
});

test('buildStatus: malformed lines in degradation.jsonl are skipped', async () => {
  const { rootDir, homeDir, cwd } = await createMinimalFixture();
  const cxDir = path.join(cwd, '.cx');
  fs.mkdirSync(cxDir, { recursive: true });
  fs.writeFileSync(
    path.join(cxDir, 'degradation.jsonl'),
    [
      'not-json{{{',
      JSON.stringify({ ts: '2026-07-03T10:00:00.000Z', mode: 'team', subsystem: 'postgres-queue', degradedOk: true }),
      '{}',  // missing subsystem — should be skipped
      '',
    ].join('\n'),
  );

  const status = await buildStatus({
    rootDir,
    homeDir,
    cwd,
    env: {},
    probeService: silentProbeService,
  });

  // Only the one valid record with a subsystem string should appear
  assert.equal(status.degradationDetails.length, 1);
  assert.equal(status.degradationDetails[0].subsystem, 'postgres-queue');
});

test('formatStatusReport: emits Degradation details section when records present', () => {
  // Construct a minimal synthetic status object (does not call buildStatus).
  const syntheticStatus = {
    version: '0.0.1',
    lastSync: null,
    deployment: { mode: 'team', resourceMode: { queue: 'postgres', workers: 'docker', telemetry: 'remote' } },
    system: {
      overall: { status: 'healthy', summary: '1/1 core runtime surfaces reachable' },
      services: [],
      integrations: { summary: 'No integrations detected' },
      plugins: { status: 'configured', summary: '0 plugins' },
    },
    features: [],
    plugins: { status: 'configured', summary: '0 plugins', directories: [], errors: [], entries: [] },
    personas: null,
    specialists: [],
    hooks: [],
    skills: [],
    commands: [],
    cliCommands: [],
    mcpServers: [],
    publicHealth: { context: {}, coordination: {}, metadataPresence: {} },
    storage: {
      sql: { mode: 'lancedb' },
      vector: { mode: 'unknown' },
      health: {
        sql: { status: 'unavailable', message: 'test' },
        vector: { status: 'unavailable', message: 'test' },
      },
    },
    executionContractModel: null,
    sessionEfficiency: null,
    efficiencyDigest: null,
    sessionUsage: null,
    telemetryRichness: null,
    overlays: [],
    promotionRequests: [],
    degradationDetails: [
      {
        subsystem: 'intake-queue',
        declared: 'postgres',
        actual: 'git',
        reason: 'CONSTRUCT_DEGRADED_OK=postgres-queue set',
        ts: '2026-07-03T10:00:00.000Z',
        mode: 'team',
      },
    ],
  };

  const report = formatStatusReport(syntheticStatus);

  assert.ok(report.includes('Degradation details:'), 'report should include Degradation details section header');
  assert.ok(report.includes('intake-queue'), 'report should mention the subsystem');
  assert.ok(report.includes('declared=postgres'), 'report should show declared value');
  assert.ok(report.includes('actual=git'), 'report should show actual value');
  assert.ok(report.includes('CONSTRUCT_DEGRADED_OK=postgres-queue set'), 'report should show the reason');
});

test('formatStatusReport: no Degradation details section when degradationDetails is empty', () => {
  const syntheticStatus = {
    version: '0.0.1',
    lastSync: null,
    deployment: { mode: 'solo', resourceMode: { queue: 'fs', workers: 'local', telemetry: 'local' } },
    system: {
      overall: { status: 'healthy', summary: '1/1 core runtime surfaces reachable' },
      services: [],
      integrations: { summary: 'No integrations detected' },
      plugins: { status: 'configured', summary: '0 plugins' },
    },
    features: [],
    plugins: { status: 'configured', summary: '0 plugins', directories: [], errors: [], entries: [] },
    personas: null,
    specialists: [],
    hooks: [],
    skills: [],
    commands: [],
    cliCommands: [],
    mcpServers: [],
    publicHealth: { context: {}, coordination: {}, metadataPresence: {} },
    storage: null,
    executionContractModel: null,
    sessionEfficiency: null,
    efficiencyDigest: null,
    sessionUsage: null,
    telemetryRichness: null,
    overlays: [],
    promotionRequests: [],
    degradationDetails: [],
  };

  const report = formatStatusReport(syntheticStatus);

  assert.ok(!report.includes('Degradation details:'), 'report should NOT include Degradation details section when empty');
});
