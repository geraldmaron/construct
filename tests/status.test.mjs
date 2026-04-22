/**
 * tests/status.test.mjs — <one-line purpose>
 *
 * <2–6 line summary: what it does, who calls it, key side effects.>
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildStatus, formatStatusReport } from '../lib/status.mjs';
import { writeEnvValues } from '../lib/env-config.mjs';

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

async function createFixture() {
  const rootDir = tempDir('construct-status-root-');
  const homeDir = tempDir('construct-status-home-');

  writeJson(path.join(rootDir, 'package.json'), { name: 'construct', version: '9.9.9' });
  writeJson(path.join(rootDir, 'agents', 'registry.json'), {
    prefix: 'cx',
    personas: [{ name: 'construct', displayName: 'Construct', role: 'orchestrator', description: 'Public entry point' }],
    agents: [{ name: 'engineer', description: 'Implements changes' }],
  });
  writeText(path.join(rootDir, '.env'), 'DASHBOARD_PORT=4242\nMEMORY_PORT=8765\nBRIDGE_PORT=5173\nLANGFUSE_BASEURL=https://cloud.langfuse.com\n');
  writeJson(path.join(rootDir, '.cx', 'workflow.json'), {
    id: 'wf-1',
    title: 'Status work',
    phase: 'implement',
    status: 'in_progress',
    currentTaskKey: 'todo:1',
    tasks: [{
      key: 'todo:1',
      title: 'Implement status',
      phase: 'implement',
      owner: 'cx-engineer',
      status: 'in-progress',
      readFirst: ['bin/construct'],
      doNotChange: ['.env'],
      acceptanceCriteria: ['status exists'],
      verification: ['npm test'],
    }],
  });
  writeJson(path.join(rootDir, '.cx', 'context.json'), {
    format: 'json',
    savedAt: '2026-04-19T05:15:00.000Z',
    contextSummary: 'Phase 3 complete, Phase 4 next.',
    markdown: '# Context\n\nPhase 3 complete, Phase 4 next.\n',
    activeWork: ['Phase 4 parity'],
  });
  writeJson(path.join(homeDir, '.claude', 'settings.json'), {
    mcpServers: { github: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' } },
    hooks: { Stop: [{ description: 'workflow-guard', background: false }] },
  });
  writeJson(path.join(homeDir, '.cursor', 'mcp.json'), { mcpServers: {} });
  writeJson(path.join(homeDir, '.config', 'opencode', 'opencode.json'), {
    mcp: { cass: { type: 'local', command: ['npx', '-y', '@modelcontextprotocol/server-memory@latest'] } },
  });
  writeJson(path.join(homeDir, '.construct', 'features.json'), { enabled: ['github', 'memory'] });
  writeJson(path.join(homeDir, '.cx', 'session-efficiency.json'), {
    readCount: 6,
    uniqueFileCount: 4,
    repeatedReadCount: 2,
    largeReadCount: 1,
    totalBytesRead: 24576,
    lastUpdatedAt: new Date().toISOString(),
  });
  writeText(path.join(homeDir, '.cx', 'session-cost.jsonl'), [
    JSON.stringify({ ts: '2026-04-18T00:00:00.000Z', input_tokens: 120, output_tokens: 30, cost_usd: 0.00081 }),
    JSON.stringify({ ts: '2026-04-18T00:05:00.000Z', input_tokens: 80, output_tokens: 20, cost_usd: 0.00054 }),
    '',
  ].join('\n'));
  writeJson(path.join(rootDir, '.cx', 'domain-overlays', 'terraform.json'), {
    id: 'terraform',
    type: 'domain-overlay',
    domain: 'terraform',
    objective: 'design infra patterns',
    attachTo: ['cx-architect'],
    focus: 'architecture',
    status: 'active',
  });
  writeJson(path.join(rootDir, '.cx', 'promotion-requests', 'terraform.json'), {
    id: 'terraform',
    type: 'promotion-request',
    domain: 'terraform',
    status: 'pending_review',
    attachTo: ['cx-architect'],
    reviewFlow: ['cx-architect', 'cx-devil-advocate', 'cx-docs-keeper'],
    challenge: { required: true, owner: 'cx-devil-advocate', status: 'pending' },
  });

  return { rootDir, homeDir };
}

test('buildStatus separates runtime health from configured integrations', async () => {
  const { rootDir, homeDir } = await createFixture();
  const probeMap = new Map([
    ['http://127.0.0.1:4242', { status: 'healthy', message: 'Reachable' }],
    ['https://cloud.langfuse.com/api/public/health', { status: 'unavailable', message: 'Connection refused' }],
    ['http://127.0.0.1:8765/', { status: 'healthy', message: 'Reachable' }],
    ['http://127.0.0.1:5173', { status: 'degraded', message: 'HTTP 503' }],
  ]);

  const originalFetch = global.fetch;
  global.fetch = async () => { throw Object.assign(new Error('refused'), { cause: { code: 'ECONNREFUSED' } }); };

  let status;
  try {
    status = await buildStatus({
      rootDir,
      homeDir,
      cwd: rootDir,
      probeService: async (service) => probeMap.get(service.url),
      env: {},
    });
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(status.system.overall.status, 'degraded');
  assert.equal(status.system.services.find((service) => service.id === 'dashboard').status, 'healthy');
  assert.equal(status.system.services.find((service) => service.id === 'langfuse').status, 'unavailable');
  assert.equal(status.features.find((feature) => feature.id === 'github').status, 'configured');
  assert.equal(status.features.find((feature) => feature.id === 'memory').status, 'configured');
  assert.match(status.system.integrations.summary, /configured/);
  assert.equal(status.workflow.status, 'pass');
  assert.deepEqual(status.publicHealth.activeTask, {
    key: 'todo:1',
    title: 'Implement status',
    phase: 'implement',
    owner: 'cx-engineer',
    status: 'in-progress',
  });
  assert.equal(status.publicHealth.context.source, 'json');
  assert.equal(status.publicHealth.context.summary, 'Phase 3 complete, Phase 4 next.');
  assert.equal(status.publicHealth.workflow.currentTaskKey, 'todo:1');
  assert.equal(status.publicHealth.alignment.status, 'pass');
  assert.equal(status.publicHealth.metadataPresence.executionContractModel, true);
  assert.equal(status.publicHealth.metadataPresence.contextState, true);
  assert.equal(status.executionContractModel.version, 'v1');
  assert.equal(status.executionContractModel.selectedTier, null);
  assert.equal(status.executionContractModel.selectedModel, null);
  assert.equal(status.executionContractModel.tiers.reasoning.model, 'openrouter/deepseek/deepseek-r1');
  assert.equal(status.executionContractModel.tiers.standard.model, 'openrouter/qwen/qwen3-coder:free');
  assert.equal(status.executionContractModel.tiers.fast.model, 'openrouter/meta-llama/llama-3.3-70b-instruct:free');
  assert.equal(status.sessionEfficiency.score, 0.87);
  assert.equal(status.sessionUsage.status, 'available');
  assert.equal(status.sessionUsage.totalTokens, 250);
  assert.equal(status.sessionUsage.interactions, 2);
  assert.equal(status.telemetryRichness.status, 'unavailable');
});

test('optional runtime surfaces do not degrade overall status', async () => {
  const { rootDir, homeDir } = await createFixture();
  const probeMap = new Map([
    ['http://127.0.0.1:4242', { status: 'healthy', message: 'Reachable' }],
    ['https://cloud.langfuse.com/api/public/health', { status: 'healthy', message: 'Reachable' }],
    ['http://127.0.0.1:8765/', { status: 'healthy', message: 'Reachable' }],
    ['http://127.0.0.1:5173', { status: 'unavailable', message: 'Connection refused' }],
  ]);

  const status = await buildStatus({
    rootDir,
    homeDir,
    cwd: rootDir,
    probeService: async (service) => probeMap.get(service.url),
    env: {},
  });

  assert.equal(status.system.overall.status, 'healthy');
  assert.match(status.system.overall.summary, /optional unavailable/);
  assert.equal(status.system.services.find((service) => service.id === 'opencode').status, 'unavailable');
});

test('formatStatusReport prints canonical overall summary and integrations', async () => {
  const { rootDir, homeDir } = await createFixture();
  const status = await buildStatus({
    rootDir,
    homeDir,
    cwd: rootDir,
    probeService: async (service) => ({ status: service.id === 'langfuse' ? 'unavailable' : 'healthy', message: 'ok' }),
    env: {},
  });

  const report = formatStatusReport(status);
  assert.match(report, /Construct Status/);
  assert.match(report, /Overall: degraded/);
  assert.match(report, /Workflow: pass/);
  assert.match(report, /Efficiency: healthy/);
  assert.match(report, /Usage: available · 2 interactions · 250 tokens · \$0\.00/);
  assert.match(report, /Last interaction: 100 tokens \(80 in \/ 20 out\)/);
  assert.match(report, /Telemetry:/);
  assert.match(report, /Overlays: 1 active/);
  assert.match(report, /Promotion requests: 1/);
  assert.match(report, /Runtime/);
  assert.match(report, /Integrations:/);
  assert.match(report, /GitHub/);
});

test('status json includes Langfuse telemetry health payload', async () => {
  const { rootDir, homeDir } = await createFixture();

  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/api/public/traces')) {
      return { ok: true, status: 200, json: async () => ({
        data: [
          { id: 't1', input: { a: 1 }, output: { b: 2 }, observationCount: 2, metadata: { x: true } },
          { id: 't2', input: null, output: null, observationCount: 1, metadata: {} },
        ],
      }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  try {
    const status = await buildStatus({
      rootDir,
      homeDir,
      cwd: rootDir,
      probeService: async () => ({ status: 'healthy', message: 'ok' }),
      env: { LANGFUSE_PUBLIC_KEY: 'pk-lf-test', LANGFUSE_SECRET_KEY: 'sk-lf-test' },
    });

    assert.equal(status.telemetryRichness.status, 'healthy');
    assert.match(status.telemetryRichness.summary, /rich 1/);
    assert.match(status.telemetryRichness.summary, /partial 1/);
    assert.equal(status.executionContractModel.version, 'v1');
  } finally {
    global.fetch = originalFetch;
  }
});

test('buildStatus marks telemetry richness degraded when coverage is low', async () => {
  const { rootDir, homeDir } = await createFixture();

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: [
        { id: 't1', input: null, output: null, observationCount: 0, metadata: {} },
        { id: 't2', input: null, output: null, observationCount: 0, metadata: {} },
        { id: 't3', input: { a: 1 }, output: null, observationCount: 0, metadata: {} },
      ],
    }),
  });

  try {
    const status = await buildStatus({
      rootDir,
      homeDir,
      cwd: rootDir,
      probeService: async () => ({ status: 'healthy', message: 'ok' }),
      env: { LANGFUSE_PUBLIC_KEY: 'pk-lf-test', LANGFUSE_SECRET_KEY: 'sk-lf-test' },
    });

    assert.equal(status.telemetryRichness.status, 'degraded');
    assert.match(status.telemetryRichness.summary, /coverage 17%/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('buildStatus marks controlled rich telemetry healthy', async () => {
  const { rootDir, homeDir } = await createFixture();

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: [
        { id: 't1', input: { a: 1 }, output: { b: 2 }, observationCount: 2, metadata: { x: true } },
        { id: 't2', input: { a: 1 }, output: { b: 2 }, observationCount: 3, metadata: { y: true } },
        { id: 't3', input: { a: 1 }, output: { b: 2 }, observationCount: 2, metadata: { z: true } },
        { id: 't4', input: { a: 1 }, output: { b: 2 }, observationCount: 2, metadata: { z: true } },
        { id: 't5', input: { a: 1 }, output: { b: 2 }, observationCount: 2, metadata: { z: true } },
        { id: 't6', input: { a: 1 }, output: { b: 2 }, observationCount: 2, metadata: { z: true } },
        { id: 't7', input: { a: 1 }, output: { b: 2 }, observationCount: 2, metadata: { z: true } },
        { id: 't8', input: { a: 1 }, output: { b: 2 }, observationCount: 2, metadata: { z: true } },
        { id: 't9', input: { a: 1 }, output: { b: 2 }, observationCount: 2, metadata: { z: true } },
        { id: 't10', input: { a: 1 }, output: { b: 2 }, observationCount: 1, metadata: {} },
      ],
    }),
  });

  try {
    const status = await buildStatus({
      rootDir,
      homeDir,
      cwd: rootDir,
      probeService: async () => ({ status: 'healthy', message: 'ok' }),
      env: { LANGFUSE_PUBLIC_KEY: 'pk-lf-test', LANGFUSE_SECRET_KEY: 'sk-lf-test' },
    });

    assert.equal(status.telemetryRichness.status, 'healthy');
    assert.match(status.telemetryRichness.summary, /rich 10/);
    assert.match(status.telemetryRichness.summary, /coverage/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('buildStatus reflects env overrides in execution-contract model metadata', async () => {
  const { rootDir, homeDir } = await createFixture();

  const status = await buildStatus({
    rootDir,
    homeDir,
    cwd: rootDir,
    probeService: async () => ({ status: 'healthy', message: 'ok' }),
    env: {
      CX_MODEL_REASONING: 'env/reasoning',
      CX_MODEL_STANDARD: 'env/standard',
      CX_MODEL_FAST: 'env/fast',
    },
  });

  assert.deepEqual(status.executionContractModel.tiers, {
    reasoning: { model: 'env/reasoning', source: 'env override' },
    standard: { model: 'env/standard', source: 'env override' },
    fast: { model: 'env/fast', source: 'env override' },
  });
});

test('buildStatus reports missing context source in public health surface when no context exists', async () => {
  const { rootDir, homeDir } = await createFixture();
  fs.rmSync(path.join(rootDir, '.cx', 'context.json'));

  const status = await buildStatus({
    rootDir,
    homeDir,
    cwd: rootDir,
    probeService: async () => ({ status: 'healthy', message: 'ok' }),
    env: {},
  });

  assert.equal(status.publicHealth.context.source, 'missing');
  assert.equal(status.publicHealth.metadataPresence.contextState, false);
});

test('buildStatus reports unavailable session usage when no token log exists', async () => {
  const { rootDir, homeDir } = await createFixture();
  fs.rmSync(path.join(homeDir, '.cx', 'session-cost.jsonl'));

  const status = await buildStatus({
    rootDir,
    homeDir,
    cwd: rootDir,
    probeService: async () => ({ status: 'healthy', message: 'ok' }),
    env: {},
  });

  assert.equal(status.sessionUsage.status, 'unavailable');
  assert.match(status.sessionUsage.summary, /No token usage recorded yet/);
});

test('buildStatus reports canonical cache fields with bounded read rate', async () => {
  const { rootDir, homeDir } = await createFixture();
  writeText(path.join(homeDir, '.cx', 'session-cost.jsonl'), [
    JSON.stringify({
      ts: '2026-04-18T00:00:00.000Z',
      input_tokens: 100,
      output_tokens: 25,
      cache_read_input_tokens: 300,
      cache_creation_input_tokens: 50,
      cost_usd: 0.002,
    }),
    '',
  ].join('\n'));

  const status = await buildStatus({
    rootDir,
    homeDir,
    cwd: rootDir,
    probeService: async () => ({ status: 'healthy', message: 'ok' }),
    env: {},
  });

  assert.equal(status.sessionUsage.inputTokens, 100);
  assert.equal(status.sessionUsage.cacheReadInputTokens, 300);
  assert.equal(status.sessionUsage.cacheCreationInputTokens, 50);
  assert.equal(status.sessionUsage.processedInputTokens, 450);
  assert.equal(status.sessionUsage.cacheReadRate, 0.667);
  assert.ok(status.sessionUsage.cacheReadRate <= 1);
});

test('buildStatus reports Langfuse unavailable when trace backend is unreachable', async () => {
  const { rootDir, homeDir } = await createFixture();

  const originalFetch = global.fetch;
  global.fetch = async () => { throw Object.assign(new Error('refused'), { cause: { code: 'ECONNREFUSED' } }); };

  try {
    const status = await buildStatus({
      rootDir,
      homeDir,
      cwd: rootDir,
      probeService: async () => ({ status: 'healthy', message: 'ok' }),
      env: { LANGFUSE_PUBLIC_KEY: 'pk-lf-test', LANGFUSE_SECRET_KEY: 'sk-lf-test' },
    });

    assert.equal(status.telemetryRichness.status, 'unavailable');
    assert.match(status.telemetryRichness.summary, /Langfuse/);
  } finally {
    global.fetch = originalFetch;
  }
});


test('formatStatusReport shows explicit byte-budget warning when session bytes are high', async () => {
  const { rootDir, homeDir } = await createFixture();
  writeJson(path.join(homeDir, '.cx', 'session-efficiency.json'), {
    readCount: 18,
    uniqueFileCount: 9,
    repeatedReadCount: 6,
    largeReadCount: 4,
    totalBytesRead: 900000,
    lastUpdatedAt: new Date().toISOString(),
  });

  const status = await buildStatus({
    rootDir,
    homeDir,
    cwd: rootDir,
    probeService: async (service) => ({ status: service.id === 'langfuse' ? 'unavailable' : 'healthy', message: 'ok' }),
    env: {},
  });

  const report = formatStatusReport(status);
  assert.match(report, /Warning: High byte budget usage:/);
  assert.ok(Array.isArray(status.sessionEfficiency.warnings));
  assert.ok(status.sessionEfficiency.warnings.length >= 1);
});

test('buildStatus uses managed dashboard port from user config when present', async () => {
  const { rootDir, homeDir } = await createFixture();
  writeEnvValues(path.join(homeDir, '.construct', 'config.env'), { DASHBOARD_PORT: '4343' });

  const status = await buildStatus({
    rootDir,
    homeDir,
    cwd: rootDir,
    probeService: async (service) => ({ status: 'healthy', message: service.url }),
    env: {},
  });

  assert.equal(status.system.services.find((service) => service.id === 'dashboard').url, 'http://127.0.0.1:4343');
});
