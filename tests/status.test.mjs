/**
 * status.test.mjs — Unit tests for lib/status.mjs project health summary.
 *
 * Covers: tracker config detection, blocked-task surfacing, MCP surface
 * checks, and public-health metadata parity with the MCP status tool.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildStatus, formatStatusReport } from '../lib/status.mjs';
import { writeEnvValues } from '../lib/env-config.mjs';
import { configDir, doctorRoot } from '../lib/config/xdg.mjs';

import { tempDir } from './helpers.mjs';

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
    models: {
      reasoning: { primary: 'claude-opus-4-1-20250805' },
      standard: { primary: 'claude-3-5-sonnet-20241022' },
      fast: { primary: 'claude-3-5-haiku-20241022' },
    },
    personas: [{ name: 'construct', displayName: 'Construct', role: 'orchestrator', description: 'Public entry point' }],
    agents: [{ name: 'engineer', description: 'Implements changes' }],
  });
  writeText(path.join(rootDir, '.env'), 'DASHBOARD_PORT=4242\nMEMORY_PORT=8765\nBRIDGE_PORT=5173\nCONSTRUCT_TELEMETRY_URL=https://telemetry.example.com\n');
  writeText(path.join(rootDir, 'plan.md'), '# Plan\n\n## Current slice\n\n- Keep coordination tracker-backed.\n- Assign one writer per file.\n');
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
  writeText(path.join(homeDir, '.codex', 'config.toml'), [
    '[plugins."github@openai-curated"]',
    'enabled = true',
    '',
  ].join('\n'));
  writeJson(path.join(homeDir, '.cursor', 'mcp.json'), { mcpServers: {} });
  writeJson(path.join(homeDir, '.config', 'opencode', 'opencode.json'), {
    mcp: { memory: { type: 'remote', url: 'http://127.0.0.1:8765/' } },
  });
  writeJson(path.join(configDir(homeDir), 'features.json'), { enabled: ['github', 'memory'] });
  writeJson(path.join(doctorRoot(homeDir), 'session-efficiency.json'), {
    readCount: 6,
    uniqueFileCount: 4,
    repeatedReadCount: 2,
    largeReadCount: 1,
    totalBytesRead: 24576,
    lastUpdatedAt: new Date().toISOString(),
  });
  writeText(path.join(doctorRoot(homeDir), 'session-cost.jsonl'), [
    JSON.stringify({ ts: '2026-04-18T00:00:00.000Z', input_tokens: 120, output_tokens: 30, reasoning_tokens: 10, total_tokens: 160, cost_usd: 0.00081 }),
    JSON.stringify({ ts: '2026-04-18T00:05:00.000Z', input_tokens: 80, output_tokens: 20, reasoning_tokens: 5, total_tokens: 105, cost_usd: 0.00054 }),
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
    ['https://telemetry.example.com/api/public/traces?limit=1', { status: 'unavailable', message: 'Connection refused' }],
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

  // Telemetry and memory are optional (impactsOverall: false) — no required service down → overall healthy
  assert.equal(status.system.overall.status, 'healthy');
  assert.equal(status.system.services.find((service) => service.id === 'telemetry').status, 'unavailable');
  assert.equal(status.features.find((feature) => feature.id === 'github').status, 'configured');
  // Memory MCP has all hosts unsupported — served through construct-mcp built-in, so it's 'configured'
  assert.equal(status.features.find((feature) => feature.id === 'memory').status, 'configured');
  assert.match(status.system.integrations.summary, /configured/);
  assert.equal(status.system.plugins.status, 'configured');
  assert.match(status.system.plugins.summary, /1 plugin/);
  assert.equal(status.plugins.entries.length, 1);
  assert.equal(status.plugins.entries[0].id, 'construct-builtins');
  assert.equal(status.plugins.errors.length, 0);
  assert.equal(status.publicHealth.context.source, 'json');
  assert.equal(status.publicHealth.context.summary, 'Phase 3 complete, Phase 4 next.');
  assert.equal(status.publicHealth.coordination.authority, 'external-tracker-plus-plan');
  assert.equal(status.publicHealth.coordination.fileOwnershipRule, 'single-writer');
  assert.equal(status.publicHealth.coordination.memoryRole, 'cross-session-recall');
  assert.equal(status.publicHealth.metadataPresence.executionContractModel, true);
  assert.equal(status.publicHealth.metadataPresence.contextState, true);
  assert.equal(status.executionContractModel.version, 'v1');
  assert.equal(status.executionContractModel.selectedTier, null);
  assert.equal(status.executionContractModel.selectedModel, null);
  assert.equal(status.executionContractModel.tiers.reasoning.model, null);
  assert.equal(status.executionContractModel.tiers.standard.model, null);
  assert.equal(status.executionContractModel.tiers.fast.model, null);
  assert.equal(status.sessionEfficiency.score, 0.87);
  assert.equal(status.sessionUsage.status, 'available');
  assert.equal(status.sessionUsage.providerTotalTokens, 265);
  assert.equal(status.sessionUsage.billedTotalTokens, 265);
  assert.equal(status.sessionUsage.interactions, 2);
  assert.equal(status.telemetryRichness.status, 'unavailable');
});

test('optional runtime surfaces do not degrade overall status', async () => {
  const { rootDir, homeDir } = await createFixture();
  const probeMap = new Map([
    ['http://127.0.0.1:4242', { status: 'healthy', message: 'Reachable' }],
    ['https://telemetry.example.com/api/public/traces?limit=1', { status: 'healthy', message: 'Reachable' }],
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
  assert.equal(status.plugins.entries.length, 1);
});

test('github feature counts the Codex GitHub plugin as configured', async () => {
  const { rootDir, homeDir } = await createFixture();
  writeJson(path.join(homeDir, '.claude', 'settings.json'), {
    mcpServers: {},
    hooks: { Stop: [{ description: 'workflow-guard', background: false }] },
  });

  const status = await buildStatus({
    rootDir,
    homeDir,
    cwd: rootDir,
    probeService: async (service) => ({ status: service.id === 'telemetry' ? 'unavailable' : 'healthy', message: 'ok' }),
    env: {},
  });

  const github = status.features.find((feature) => feature.id === 'github');
  assert.equal(github.status, 'configured');
  assert.match(github.message, /Codex Plugin/);
  assert.equal(status.system.plugins.status, 'configured');
});

test('formatStatusReport prints canonical overall summary and integrations', async () => {
  const { rootDir, homeDir } = await createFixture();
  const status = await buildStatus({
    rootDir,
    homeDir,
    cwd: rootDir,
    probeService: async (service) => ({ status: service.id === 'telemetry' ? 'unavailable' : 'healthy', message: 'ok' }),
    env: {},
  });

  const report = formatStatusReport(status);
  assert.match(report, /Construct Status/);
  // Telemetry has impactsOverall: false — its status never degrades overall health
  assert.match(report, /Overall: healthy/);
  assert.match(report, /Coordination: external tracker \+ plan\.md · single-writer per file · cass-memory for recall/);
  assert.match(report, /Efficiency: healthy/);
  assert.match(report, /Usage: available · 2 interactions · 265 provider · 265 billed \(.*?% cache read · .*?% cache write · .*?% fresh\)/);
  assert.match(report, /Last interaction: 105 provider total · 105 billed total/); 
  // Note: last interaction line format is from the cli status builder, not the summary above
  assert.match(report, /Telemetry:/);
  assert.match(report, /Overlays: 1 active/);
  assert.match(report, /Promotion requests: 1/);
  assert.match(report, /Runtime/);
  assert.match(report, /Integrations:/);
  assert.match(report, /Plugins:/);
  assert.match(report, /GitHub/);
});

test('buildStatus surfaces external plugin manifests and validation errors', async () => {
  const { rootDir, homeDir } = await createFixture();
  const pluginDir = path.join(rootDir, '.cx', 'plugins');
  fs.mkdirSync(pluginDir, { recursive: true });
  writeJson(path.join(pluginDir, 'acme.json'), {
    version: 1,
    plugins: [{
      id: 'acme',
      name: 'Acme',
      version: '0.1.0',
      description: 'External plugin',
      mcps: [{
        id: 'acme-search',
        name: 'Acme Search',
        category: 'integration',
        description: 'Search Acme',
        command: 'npx',
        args: ['-y', '@acme/search-mcp'],
        env: {},
        requiredEnv: [],
        usedBy: ['construct'],
      }],
    }],
  });
  writeJson(path.join(pluginDir, 'broken.json'), {
    version: 1,
    plugins: [{
      id: 'broken',
      version: '0.0.1',
      description: 'Broken manifest',
      mcps: [],
    }],
  });

  const status = await buildStatus({
    rootDir,
    homeDir,
    cwd: rootDir,
    probeService: async (service) => ({ status: service.id === 'telemetry' ? 'unavailable' : 'healthy', message: 'ok' }),
    env: {},
  });

  assert.equal(status.system.plugins.status, 'degraded');
  assert.equal(status.plugins.entries.some((plugin) => plugin.id === 'acme'), true);
  assert.equal(status.plugins.errors.length > 0, true);
  assert.match(status.plugins.errors.join('\n'), /missing string name/);
});

test('status json includes telemetry health payload', async () => {
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
      env: { CONSTRUCT_TRACE_BACKEND: 'langfuse', CONSTRUCT_TELEMETRY_URL: 'https://telemetry.example.com', CONSTRUCT_TELEMETRY_PUBLIC_KEY: 'pk-lf-test', CONSTRUCT_TELEMETRY_SECRET_KEY: 'sk-lf-test' },
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
      env: { CONSTRUCT_TRACE_BACKEND: 'langfuse', CONSTRUCT_TELEMETRY_URL: 'https://telemetry.example.com', CONSTRUCT_TELEMETRY_PUBLIC_KEY: 'pk-lf-test', CONSTRUCT_TELEMETRY_SECRET_KEY: 'sk-lf-test' },
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
      env: { CONSTRUCT_TRACE_BACKEND: 'langfuse', CONSTRUCT_TELEMETRY_URL: 'https://telemetry.example.com', CONSTRUCT_TELEMETRY_PUBLIC_KEY: 'pk-lf-test', CONSTRUCT_TELEMETRY_SECRET_KEY: 'sk-lf-test' },
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
  fs.rmSync(path.join(doctorRoot(homeDir), 'session-cost.jsonl'));

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
  writeText(path.join(doctorRoot(homeDir), 'session-cost.jsonl'), [
    JSON.stringify({
      ts: '2026-04-18T00:00:00.000Z',
      input_tokens: 100,
      output_tokens: 25,
      reasoning_tokens: 9,
      total_tokens: 134,
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
  assert.equal(status.sessionUsage.reasoningTokens, 9);
  assert.equal(status.sessionUsage.cacheReadInputTokens, 300);
  assert.equal(status.sessionUsage.cacheCreationInputTokens, 50);
  assert.equal(status.sessionUsage.processedInputTokens, 450);
  assert.equal(status.sessionUsage.providerTotalTokens, 134);
  assert.equal(status.sessionUsage.billedTotalTokens, 484);
  assert.equal(status.sessionUsage.cacheReadRate, 0.667);
  assert.ok(status.sessionUsage.cacheReadRate <= 1);
});

test('buildStatus reports telemetry unavailable when trace backend is unreachable', async () => {
  const { rootDir, homeDir } = await createFixture();

  const originalFetch = global.fetch;
  global.fetch = async () => { throw Object.assign(new Error('refused'), { cause: { code: 'ECONNREFUSED' } }); };

  try {
    const status = await buildStatus({
      rootDir,
      homeDir,
      cwd: rootDir,
      probeService: async () => ({ status: 'healthy', message: 'ok' }),
      env: { CONSTRUCT_TRACE_BACKEND: 'langfuse', CONSTRUCT_TELEMETRY_URL: 'https://telemetry.example.com', CONSTRUCT_TELEMETRY_PUBLIC_KEY: 'pk-lf-test', CONSTRUCT_TELEMETRY_SECRET_KEY: 'sk-lf-test' },
    });

    assert.equal(status.telemetryRichness.status, 'unavailable');
    assert.match(status.telemetryRichness.summary, /Telemetry/);
  } finally {
    global.fetch = originalFetch;
  }
});


test('formatStatusReport shows explicit byte-budget warning when session bytes are high', async () => {
  const { rootDir, homeDir } = await createFixture();
  writeJson(path.join(doctorRoot(homeDir), 'session-efficiency.json'), {
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
    probeService: async (service) => ({ status: service.id === 'telemetry' ? 'unavailable' : 'healthy', message: 'ok' }),
    env: {},
  });

  const report = formatStatusReport(status);
  assert.match(report, /Warning: High byte budget usage:/);
  assert.ok(Array.isArray(status.sessionEfficiency.warnings));
  assert.ok(status.sessionEfficiency.warnings.length >= 1);
});

test('buildStatus marks telemetry richness credentials-invalid when telemetry auth fails', async () => {
  const { rootDir, homeDir } = await createFixture();
  writeEnvValues(path.join(configDir(homeDir), 'config.env'), {
    CONSTRUCT_TRACE_BACKEND: 'langfuse',
    CONSTRUCT_TELEMETRY_URL: 'http://localhost:3000',
    CONSTRUCT_TELEMETRY_PUBLIC_KEY: 'pk-lf-test',
    CONSTRUCT_TELEMETRY_SECRET_KEY: 'sk-lf-test',
  });

  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('/api/public/traces')) {
      return {
        ok: false,
        status: 401,
      };
    }
    throw new Error(`Unexpected fetch ${url}`);
  };

  try {
    const status = await buildStatus({
      rootDir,
      homeDir,
      cwd: rootDir,
      probeService: async () => ({ status: 'healthy', message: 'ok' }),
      env: {},
    });

    assert.equal(status.telemetryRichness.status, 'credentials-invalid');
    assert.match(status.telemetryRichness.summary, /credentials rejected/);
    assert.match(status.telemetryRichness.summary, /construct init/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('buildStatus detects MCP configured via alias in settings.json', async () => {
  const { rootDir, homeDir } = await createFixture();
  // Configure atlassian under its common alias 'atlassian-mcp-server'
  writeJson(path.join(homeDir, '.claude', 'settings.json'), {
    mcpServers: {
      'atlassian-mcp-server': { type: 'http', url: 'https://mcp.atlassian.com/v1/mcp' },
    },
    hooks: {},
  });
  // Remove features.json so all features are implicitly enabled
  fs.rmSync(path.join(configDir(homeDir), 'features.json'), { force: true });

  const status = await buildStatus({
    rootDir,
    homeDir,
    cwd: rootDir,
    probeService: async () => ({ status: 'healthy', message: 'ok' }),
    env: {},
  });

  const atlassian = status.features.find((feature) => feature.id === 'atlassian');
  assert.equal(atlassian.status, 'configured');
  assert.match(atlassian.message, /Claude Code/);
});

test('buildStatus detects MCP configured via project .mcp.json', async () => {
  const { rootDir, homeDir } = await createFixture();
  // Clear global settings so the only source is project-level
  writeJson(path.join(homeDir, '.claude', 'settings.json'), { mcpServers: {}, hooks: {} });
  // Remove codex config to avoid cross-detection
  fs.rmSync(path.join(homeDir, '.codex'), { recursive: true, force: true });
  // Remove features.json so all features are implicitly enabled
  fs.rmSync(path.join(configDir(homeDir), 'features.json'), { force: true });
  // Add project-level .mcp.json with notion
  writeJson(path.join(rootDir, '.mcp.json'), {
    mcpServers: { notion: { command: 'npx', args: ['-y', '@anthropic-ai/notion-mcp'] } },
  });

  const status = await buildStatus({
    rootDir,
    homeDir,
    cwd: rootDir,
    probeService: async () => ({ status: 'healthy', message: 'ok' }),
    env: {},
  });

  const notion = status.features.find((feature) => feature.id === 'notion');
  assert.equal(notion.status, 'configured');
  assert.match(notion.message, /Claude Code/);
});

test('buildStatus detects MCP registered as Claude.ai server-side integration', async () => {
  const { rootDir, homeDir } = await createFixture();
  writeJson(path.join(homeDir, '.claude', 'settings.json'), { mcpServers: {}, hooks: {} });
  fs.rmSync(path.join(homeDir, '.codex'), { recursive: true, force: true });
  fs.rmSync(path.join(configDir(homeDir), 'features.json'), { force: true });
  // Register notion as a Claude.ai managed MCP
  writeJson(path.join(configDir(homeDir), 'claude-ai-mcps.json'), { mcps: ['notion'] });

  const status = await buildStatus({
    rootDir,
    homeDir,
    cwd: rootDir,
    probeService: async () => ({ status: 'healthy', message: 'ok' }),
    env: {},
  });

  const notion = status.features.find((feature) => feature.id === 'notion');
  assert.equal(notion.status, 'configured');
  assert.match(notion.message, /Claude\.ai/);
});

test('buildStatus detects MCP from Claude marketplace plugins', async () => {
  const { rootDir, homeDir } = await createFixture();
  // Clear global settings
  writeJson(path.join(homeDir, '.claude', 'settings.json'), { mcpServers: {}, hooks: {} });
  fs.rmSync(path.join(homeDir, '.codex'), { recursive: true, force: true });
  // Remove features.json so all features are implicitly enabled
  fs.rmSync(path.join(configDir(homeDir), 'features.json'), { force: true });
  // Create marketplace plugin .mcp.json with linear
  const pluginDir = path.join(homeDir, '.claude', 'plugins', 'marketplaces', 'test-market', 'external_plugins', 'linear');
  writeJson(path.join(pluginDir, '.mcp.json'), {
    linear: { command: 'npx', args: ['-y', '@linear/mcp-server'] },
  });

  const status = await buildStatus({
    rootDir,
    homeDir,
    cwd: rootDir,
    probeService: async () => ({ status: 'healthy', message: 'ok' }),
    env: {},
  });

  const linear = status.features.find((feature) => feature.id === 'linear');
  assert.equal(linear.status, 'configured');
  assert.match(linear.message, /Claude Code/);
});

// ── recentRunExecutionStates: prepared vs executed recent runs (LMCP-F4) ────

function writeOrchestrationRun(rootDir, run) {
  const dir = path.join(rootDir, '.cx', 'runtime', 'orchestration', 'runs');
  writeJson(path.join(dir, `${run.runId}.json`), run);
}

test('construct status distinguishes prepared vs executed recent runs', async () => {
  const { rootDir, homeDir } = await createFixture();

  writeOrchestrationRun(rootDir, {
    runId: 'run-prepared-1',
    status: 'completed-prepare-only',
    executionState: 'prepared',
    createdAt: '2026-07-01T00:00:00.000Z',
    tasks: [{ id: 't1', role: 'cx-engineer', status: 'prepared', executionState: 'prepared' }],
  });
  writeOrchestrationRun(rootDir, {
    runId: 'run-executed-1',
    status: 'completed',
    executionState: 'executed',
    createdAt: '2026-07-02T00:00:00.000Z',
    tasks: [{ id: 't1', role: 'cx-engineer', status: 'done', executionState: 'executed' }],
  });
  writeOrchestrationRun(rootDir, {
    runId: 'run-failed-1',
    status: 'completed-with-failures',
    executionState: 'failed',
    createdAt: '2026-07-03T00:00:00.000Z',
    tasks: [{ id: 't1', role: 'cx-engineer', status: 'failed', executionState: 'failed' }],
  });

  const status = await buildStatus({
    rootDir,
    homeDir,
    cwd: rootDir,
    probeService: async () => ({ status: 'healthy', message: 'ok' }),
    env: {},
  });

  assert.equal(status.recentRunExecutionStates.total, 3);
  assert.equal(status.recentRunExecutionStates.byState.prepared, 1);
  assert.equal(status.recentRunExecutionStates.byState.executed, 1);
  assert.equal(status.recentRunExecutionStates.byState.failed, 1);
  assert.equal(status.recentRunExecutionStates.byState['degraded-executed'], 0);

  // Newest-first ordering by createdAt.
  assert.deepEqual(
    status.recentRunExecutionStates.recent.map((r) => r.runId),
    ['run-failed-1', 'run-executed-1', 'run-prepared-1'],
  );
  const preparedEntry = status.recentRunExecutionStates.recent.find((r) => r.runId === 'run-prepared-1');
  const executedEntry = status.recentRunExecutionStates.recent.find((r) => r.runId === 'run-executed-1');
  assert.equal(preparedEntry.executionState, 'prepared');
  assert.equal(executedEntry.executionState, 'executed');

  const report = formatStatusReport(status);
  assert.match(report, /Recent runs: 3 total/);
  assert.match(report, /prepared 1/);
  assert.match(report, /executed 1/);
  assert.match(report, /failed 1/);
  assert.match(report, /run-prepared-1: executionState=prepared/);
  assert.match(report, /run-executed-1: executionState=executed/);
});

test('recentRunExecutionStates buckets a pre-F4 legacy run (no executionState field) as unknown', async () => {
  const { rootDir, homeDir } = await createFixture();

  writeOrchestrationRun(rootDir, {
    runId: 'run-legacy-1',
    status: 'completed',
    createdAt: '2026-07-01T00:00:00.000Z',
    tasks: [{ id: 't1', role: 'cx-engineer', status: 'done' }],
  });

  const status = await buildStatus({
    rootDir,
    homeDir,
    cwd: rootDir,
    probeService: async () => ({ status: 'healthy', message: 'ok' }),
    env: {},
  });

  assert.equal(status.recentRunExecutionStates.total, 1);
  assert.equal(status.recentRunExecutionStates.byState.unknown, 1);
  assert.equal(status.recentRunExecutionStates.recent[0].executionState, 'unknown');
});

test('recentRunExecutionStates reports zero when no orchestration runs exist', async () => {
  const { rootDir, homeDir } = await createFixture();

  const status = await buildStatus({
    rootDir,
    homeDir,
    cwd: rootDir,
    probeService: async () => ({ status: 'healthy', message: 'ok' }),
    env: {},
  });

  assert.equal(status.recentRunExecutionStates.total, 0);
  assert.deepEqual(status.recentRunExecutionStates.recent, []);
  const report = formatStatusReport(status);
  assert.doesNotMatch(report, /Recent runs:/);
});
