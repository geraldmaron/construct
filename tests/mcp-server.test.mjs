/**
 * tests/mcp-server.test.mjs — MCP server tool contract and trace metadata tests
 *
 * Tests the MCP server tool implementations: cxTrace, project_context,
 * and related tools. Verifies execution-contract model metadata, tool schema parity,
 * and that project-context tools return the expected public health contract shape.
 * Run via npm test.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('cxTrace includes execution-contract model metadata parity', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-mcp-root-'));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-mcp-home-'));

  fs.mkdirSync(path.join(rootDir, 'agents', 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'agents', 'registry.json'), JSON.stringify({
    models: {
      reasoning: { primary: 'registry/reasoning' },
      standard: { primary: 'registry/standard' },
      fast: { primary: 'registry/fast' },
    },
    personas: [],
    agents: [{ name: 'engineer', promptFile: 'agents/prompts/cx-engineer.md' }],
  }, null, 2));
  fs.writeFileSync(path.join(rootDir, 'agents', 'prompts', 'cx-engineer.md'), '# Engineer\n');
  fs.writeFileSync(path.join(rootDir, '.env'), 'CX_MODEL_REASONING=env/reasoning\nCX_MODEL_STANDARD=env/standard\nCX_MODEL_FAST=env/fast\n');

  const originalToolkit = process.env.CX_TOOLKIT_DIR;
  const originalHome = process.env.HOME;
  const originalPublic = process.env.LANGFUSE_PUBLIC_KEY;
  const originalSecret = process.env.LANGFUSE_SECRET_KEY;
  const originalReasoning = process.env.CX_MODEL_REASONING;
  const originalStandard = process.env.CX_MODEL_STANDARD;
  const originalFast = process.env.CX_MODEL_FAST;
  const originalFetch = global.fetch;

  process.env.CX_TOOLKIT_DIR = rootDir;
  process.env.HOME = homeDir;
  process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
  process.env.LANGFUSE_SECRET_KEY = 'sk-test';
  process.env.CX_MODEL_REASONING = 'env/reasoning';
  process.env.CX_MODEL_STANDARD = 'env/standard';
  process.env.CX_MODEL_FAST = 'env/fast';

  let postedBody = null;
  global.fetch = async (_url, options = {}) => {
    postedBody = JSON.parse(options.body);
    return { ok: true, status: 200, text: async () => '' };
  };

  try {
    const { cxTrace } = await import(`../lib/mcp/server.mjs?test=${Date.now()}`);
    const result = await cxTrace({
      name: 'cx-engineer',
      input: 'fix routing issue in auth flow',
      metadata: { teamId: 'team-1' },
    });

    assert.equal(result.ok, true);
    assert.equal(postedBody.metadata.executionContractModel.version, 'v1');
    assert.equal(postedBody.metadata.executionContractModel.workCategory, 'quick');
    assert.equal(postedBody.metadata.executionContractModel.selectedTier, 'fast');
    assert.equal(postedBody.metadata.executionContractModel.selectedModel, 'env/fast');
    assert.equal(postedBody.metadata.executionContractModel.selectedModelSource, 'env override');
    assert.deepEqual(postedBody.metadata.executionContractModel.tiers, {
      reasoning: { model: 'env/reasoning', source: 'env override' },
      standard: { model: 'env/standard', source: 'env override' },
      fast: { model: 'env/fast', source: 'env override' },
    });
  } finally {
    global.fetch = originalFetch;
    if (originalToolkit === undefined) delete process.env.CX_TOOLKIT_DIR; else process.env.CX_TOOLKIT_DIR = originalToolkit;
    if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
    if (originalPublic === undefined) delete process.env.LANGFUSE_PUBLIC_KEY; else process.env.LANGFUSE_PUBLIC_KEY = originalPublic;
    if (originalSecret === undefined) delete process.env.LANGFUSE_SECRET_KEY; else process.env.LANGFUSE_SECRET_KEY = originalSecret;
    if (originalReasoning === undefined) delete process.env.CX_MODEL_REASONING; else process.env.CX_MODEL_REASONING = originalReasoning;
    if (originalStandard === undefined) delete process.env.CX_MODEL_STANDARD; else process.env.CX_MODEL_STANDARD = originalStandard;
    if (originalFast === undefined) delete process.env.CX_MODEL_FAST; else process.env.CX_MODEL_FAST = originalFast;
  }
});

test('projectContext exposes tracker-plus-plan public-health fields', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-mcp-health-root-'));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-mcp-health-home-'));

  fs.mkdirSync(path.join(rootDir, '.cx'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'agents', 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'agents', 'registry.json'), JSON.stringify({
    models: {
      reasoning: { primary: 'registry/reasoning' },
      standard: { primary: 'registry/standard' },
      fast: { primary: 'registry/fast' },
    },
    personas: [],
    agents: [],
  }, null, 2));
  fs.writeFileSync(path.join(rootDir, '.cx', 'context.json'), JSON.stringify({
    format: 'json',
    savedAt: '2026-04-19T05:15:00.000Z',
    contextSummary: 'Phase 4 active.',
    markdown: '# Context\n\nPhase 4 active.\n',
  }, null, 2));
  fs.writeFileSync(path.join(rootDir, 'plan.md'), '# Plan\n\n- Keep public health tracker-backed.\n- One writer per file.\n');

  const originalToolkit = process.env.CX_TOOLKIT_DIR;
  const originalHome = process.env.HOME;

  process.env.CX_TOOLKIT_DIR = rootDir;
  process.env.HOME = homeDir;

  try {
    const { projectContext } = await import(`../lib/mcp/server.mjs?health=${Date.now()}`);
    const project = projectContext({ cwd: rootDir });

    assert.equal(project.publicHealth.context.source, 'json');
    assert.equal(project.publicHealth.coordination.authority, 'external-tracker-plus-plan');
    assert.equal(project.publicHealth.coordination.fileOwnershipRule, 'single-writer');
    assert.equal(project.publicHealth.coordination.memoryRole, 'cross-session-recall');
    assert.equal(project.publicHealth.metadataPresence.executionContractModel, true);
    assert.equal(project.publicHealth.metadataPresence.contextState, true);
  } finally {
    if (originalToolkit === undefined) delete process.env.CX_TOOLKIT_DIR; else process.env.CX_TOOLKIT_DIR = originalToolkit;
    if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
  }
});

test('status and MCP surfaces agree on public-health metadata presence semantics', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-health-parity-root-'));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-health-parity-home-'));

  fs.mkdirSync(path.join(rootDir, '.cx'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'package.json'), JSON.stringify({ name: 'construct', version: '1.0.0' }, null, 2));
  fs.writeFileSync(path.join(rootDir, 'agents', 'registry.json'), JSON.stringify({ personas: [], agents: [] }, null, 2));
  fs.writeFileSync(path.join(rootDir, 'plan.md'), '# Plan\n\n- Keep metadata parity between status and MCP.\n');

  const originalToolkit = process.env.CX_TOOLKIT_DIR;
  const originalHome = process.env.HOME;
  process.env.CX_TOOLKIT_DIR = rootDir;
  process.env.HOME = homeDir;

  try {
    const { buildStatus } = await import('../lib/status.mjs');
    const { projectContext } = await import(`../lib/mcp/server.mjs?parity=${Date.now()}`);

    const status = await buildStatus({
      rootDir,
      homeDir,
      cwd: rootDir,
      probeService: async () => ({ status: 'healthy', message: 'ok' }),
      env: {},
    });
    const project = projectContext({ cwd: rootDir });

    assert.equal(project.publicHealth.metadataPresence.executionContractModel, status.publicHealth.metadataPresence.executionContractModel);
    assert.deepEqual(project.publicHealth.coordination, status.publicHealth.coordination);
    assert.equal(project.publicHealth.context.source, 'missing');
    assert.equal(project.publicHealth.metadataPresence.contextState, false);
  } finally {
    if (originalToolkit === undefined) delete process.env.CX_TOOLKIT_DIR; else process.env.CX_TOOLKIT_DIR = originalToolkit;
    if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
  }
});

test('extractDocumentText reads local text documents through the MCP helper', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-mcp-doc-root-'));
  const filePath = path.join(rootDir, 'notes.md');
  fs.writeFileSync(filePath, '# Notes\n\nPDF fallback should not be required here.\n');

  const { extractDocumentText } = await import(`../lib/mcp/server.mjs?doc=${Date.now()}`);
  const result = extractDocumentText({ file_path: filePath, max_chars: 200 });

  assert.equal(result.file_path, filePath);
  assert.equal(result.extension, '.md');
  assert.equal(result.extraction_method, 'utf8');
  assert.equal(result.truncated, false);
  assert.match(result.text, /PDF fallback should not be required here/);
});

test('extractDocumentText reads csv content through the shared document path', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-mcp-csv-root-'));
  const filePath = path.join(rootDir, 'metrics.csv');
  fs.writeFileSync(filePath, 'service,availability\napi,99.95\nworker,99.90\n');

  const { extractDocumentText } = await import(`../lib/mcp/server.mjs?csv=${Date.now()}`);
  const result = extractDocumentText({ file_path: filePath, max_chars: 200 });

  assert.equal(result.extension, '.csv');
  assert.equal(result.extraction_method, 'utf8');
  assert.match(result.text, /service,availability/);
  assert.match(result.text, /worker,99.90/);
});

test('ingestDocument writes a markdown artifact through the MCP helper', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-mcp-ingest-root-'));
  const filePath = path.join(rootDir, 'deck.csv');
  fs.writeFileSync(filePath, 'topic,status\nreliability,green\n');

  const { ingestDocument } = await import(`../lib/mcp/server.mjs?ingest=${Date.now()}`);
  const result = await ingestDocument({ file_path: filePath, cwd: rootDir });

  assert.equal(result.status, 'ok');
  assert.equal(result.files.length, 1);
  assert.match(result.files[0].outputPath, /\.cx\/knowledge\/internal\/deck\.csv\.md$/);
  assert.equal(fs.existsSync(result.files[0].outputPath), true);
});

test('storage MCP helpers require explicit confirmation for destructive actions', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-mcp-storage-root-'));
  fs.mkdirSync(path.join(rootDir, '.cx', 'knowledge', 'internal'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, '.cx', 'knowledge', 'internal', 'brief.md'), '# Brief\n');

  const {
    storageStatus,
    storageReset,
    deleteIngestedArtifactsTool,
  } = await import(`../lib/mcp/server.mjs?storage=${Date.now()}`);

  const status = await storageStatus({ cwd: rootDir });
  assert.equal(status.ingested.count, 1);

  const resetRejected = await storageReset({ cwd: rootDir });
  assert.equal(resetRejected.error, 'storage_reset requires confirm=true');

  const deleteRejected = deleteIngestedArtifactsTool({ cwd: rootDir });
  assert.equal(deleteRejected.error, 'delete_ingested_artifacts requires confirm=true');

  const deleteAccepted = deleteIngestedArtifactsTool({ cwd: rootDir, confirm: true });
  assert.equal(deleteAccepted.deletedCount, 1);
});
