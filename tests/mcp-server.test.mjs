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

test('cxTrace includes execution-contract model metadata parity', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-mcp-root-'));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-mcp-home-'));
  t.after(() => {
    try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(homeDir, { recursive: true, force: true }); } catch {}
  });

  fs.cpSync(path.join(process.cwd(), 'specialists', 'org'), path.join(rootDir, 'specialists', 'org'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'agents', 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'agents', 'registry.json'), JSON.stringify({
    models: {
      reasoning: { primary: 'claude-opus-4-1-20250805' },
      standard: { primary: 'claude-3-5-sonnet-20241022' },
      fast: { primary: 'claude-3-5-haiku-20241022' },
    },
    personas: [],
    agents: [{ name: 'engineer', promptFile: 'specialists/prompts/cx-engineer.md' }],
  }, null, 2));
  fs.writeFileSync(path.join(rootDir, 'agents', 'prompts', 'cx-engineer.md'), '# Engineer\n');
  fs.writeFileSync(path.join(rootDir, '.env'), 'CX_MODEL_REASONING=env/reasoning\nCX_MODEL_STANDARD=env/standard\nCX_MODEL_FAST=env/fast\n');

  const originalToolkit = process.env.CX_TOOLKIT_DIR;
  const originalHome = process.env.HOME;
  const originalPublic = process.env.CONSTRUCT_TELEMETRY_PUBLIC_KEY;
  const originalSecret = process.env.CONSTRUCT_TELEMETRY_SECRET_KEY;
  const originalUrl = process.env.CONSTRUCT_TELEMETRY_URL;
  const originalBackend = process.env.CONSTRUCT_TRACE_BACKEND;
  const originalReasoning = process.env.CX_MODEL_REASONING;
  const originalStandard = process.env.CX_MODEL_STANDARD;
  const originalFast = process.env.CX_MODEL_FAST;
  const originalFetch = global.fetch;

  process.env.CX_TOOLKIT_DIR = rootDir;
  process.env.HOME = homeDir;
  process.env.CONSTRUCT_TELEMETRY_PUBLIC_KEY = 'pk-test';
  process.env.CONSTRUCT_TELEMETRY_SECRET_KEY = 'sk-test';
  process.env.CONSTRUCT_TELEMETRY_URL = 'https://telemetry.example.com';
  process.env.CONSTRUCT_TRACE_BACKEND = 'langfuse';
  process.env.CX_MODEL_REASONING = 'env/reasoning';
  process.env.CX_MODEL_STANDARD = 'env/standard';
  process.env.CX_MODEL_FAST = 'env/fast';

  let postedBody = null;
  global.fetch = async (_url, options = {}) => {
    const envelope = JSON.parse(options.body);
    postedBody = envelope.batch[0].body;
    return { ok: true, status: 200, text: async () => '' };
  };

  try {
    const { cxTrace } = await import(`../lib/mcp/server.mjs?test=${Date.now()}`);
    const result = await cxTrace({
      name: 'cx-engineer',
      input: 'fix routing issue in auth flow',
      metadata: { teamId: 'team-1' },
    }, { ROOT_DIR: rootDir });
    console.log('DEBUG result:', JSON.stringify({ ok: result.ok, error: result.error, id: result.id }));
    assert.equal(result.ok, true);
    assert.equal(postedBody.metadata.version, 'v1');
    assert.equal(postedBody.metadata.workCategory, 'quick');
    assert.equal(postedBody.metadata.selectedTier, 'fast');
    assert.equal(postedBody.metadata.selectedModel, 'env/fast');
    assert.equal(postedBody.metadata.selectedModelSource, 'env override');
    assert.deepEqual(postedBody.metadata.tiers, {
      reasoning: { model: 'env/reasoning', source: 'env override' },
      standard: { model: 'env/standard', source: 'env override' },
      fast: { model: 'env/fast', source: 'env override' },
    });
  } finally {
    global.fetch = originalFetch;
    if (originalToolkit === undefined) delete process.env.CX_TOOLKIT_DIR; else process.env.CX_TOOLKIT_DIR = originalToolkit;
    if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
    if (originalPublic === undefined) delete process.env.CONSTRUCT_TELEMETRY_PUBLIC_KEY; else process.env.CONSTRUCT_TELEMETRY_PUBLIC_KEY = originalPublic;
    if (originalSecret === undefined) delete process.env.CONSTRUCT_TELEMETRY_SECRET_KEY; else process.env.CONSTRUCT_TELEMETRY_SECRET_KEY = originalSecret;
    if (originalUrl === undefined) delete process.env.CONSTRUCT_TELEMETRY_URL; else process.env.CONSTRUCT_TELEMETRY_URL = originalUrl;
    if (originalBackend === undefined) delete process.env.CONSTRUCT_TRACE_BACKEND; else process.env.CONSTRUCT_TRACE_BACKEND = originalBackend;
    if (originalReasoning === undefined) delete process.env.CX_MODEL_REASONING; else process.env.CX_MODEL_REASONING = originalReasoning;
    if (originalStandard === undefined) delete process.env.CX_MODEL_STANDARD; else process.env.CX_MODEL_STANDARD = originalStandard;
    if (originalFast === undefined) delete process.env.CX_MODEL_FAST; else process.env.CX_MODEL_FAST = originalFast;
  }
});

test('projectContext exposes tracker-plus-plan public-health fields', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-mcp-health-root-'));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-mcp-health-home-'));
  t.after(() => {
    try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(homeDir, { recursive: true, force: true }); } catch {}
  });

  fs.cpSync(path.join(process.cwd(), 'specialists', 'org'), path.join(rootDir, 'specialists', 'org'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, '.cx'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'agents', 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'agents', 'registry.json'), JSON.stringify({
    models: {
      reasoning: { primary: 'claude-opus-4-1-20250805' },
      standard: { primary: 'claude-3-5-sonnet-20241022' },
      fast: { primary: 'claude-3-5-haiku-20241022' },
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

test('status and MCP surfaces agree on public-health metadata presence semantics', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-health-parity-root-'));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-health-parity-home-'));
  t.after(() => {
    try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(homeDir, { recursive: true, force: true }); } catch {}
  });

  fs.cpSync(path.join(process.cwd(), 'specialists', 'org'), path.join(rootDir, 'specialists', 'org'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, '.cx'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'package.json'), JSON.stringify({ name: 'construct', version: '1.0.0' }, null, 2));
  fs.writeFileSync(path.join(rootDir, 'agents', 'registry.json'), JSON.stringify({
    models: {
      reasoning: { primary: 'claude-opus-4-1-20250805' },
      standard: { primary: 'claude-3-5-sonnet-20241022' },
      fast: { primary: 'claude-3-5-haiku-20241022' },
    },
    personas: [],
    agents: [],
  }, null, 2));
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

test('extractDocumentText reads local text documents through the MCP helper', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-mcp-doc-root-'));
  t.after(() => { try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch {} });
  const filePath = path.join(rootDir, 'notes.md');
  fs.writeFileSync(filePath, '# Notes\n\nPDF fallback should not be required here.\n');

  const { extractDocumentText } = await import(`../lib/mcp/server.mjs?doc=${Date.now()}`);
  const result = await extractDocumentText({ file_path: filePath, max_chars: 200 });

  assert.equal(result.file_path, filePath);
  assert.equal(result.extension, '.md');
  assert.equal(result.extraction_method, 'utf8');
  assert.equal(result.truncated, false);
  assert.match(result.text, /PDF fallback should not be required here/);
});

test('extractDocumentText reads csv content through the shared document path', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-mcp-csv-root-'));
  t.after(() => { try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch {} });
  const filePath = path.join(rootDir, 'metrics.csv');
  fs.writeFileSync(filePath, 'service,availability\napi,99.95\nworker,99.90\n');

  const { extractDocumentText } = await import(`../lib/mcp/server.mjs?csv=${Date.now()}`);
  const result = await extractDocumentText({ file_path: filePath, max_chars: 200 });

  assert.equal(result.extension, '.csv');
  assert.equal(result.extraction_method, 'utf8');
  assert.match(result.text, /service,availability/);
  assert.match(result.text, /worker,99.90/);
});

test('ingestDocument writes a markdown artifact through the MCP helper', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-mcp-ingest-root-'));
  t.after(() => { try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch {} });
  const filePath = path.join(rootDir, 'deck.csv');
  fs.writeFileSync(filePath, 'topic,status\nreliability,green\n');

  const { ingestDocument } = await import(`../lib/mcp/server.mjs?ingest=${Date.now()}`);
  const result = await ingestDocument({ file_path: filePath, cwd: rootDir });

  assert.equal(result.status, 'ok');
  assert.equal(result.files.length, 1);
  assert.match(result.files[0].outputPath, /\.cx\/knowledge\/internal\/deck\.csv\.md$/);
  assert.equal(fs.existsSync(result.files[0].outputPath), true);
});

test('storage MCP helpers require confirmation and an out-of-band approval token for destructive actions', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-mcp-storage-root-'));
  t.after(() => { try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch {} });
  fs.mkdirSync(path.join(rootDir, '.cx', 'knowledge', 'internal'), { recursive: true });
  const brief = path.join(rootDir, '.cx', 'knowledge', 'internal', 'brief.md');
  fs.writeFileSync(brief, '# Brief\n');

  const prevDoctorRoot = process.env.CONSTRUCT_DOCTOR_ROOT;
  process.env.CONSTRUCT_DOCTOR_ROOT = path.join(rootDir, 'state');
  t.after(() => {
    if (prevDoctorRoot === undefined) delete process.env.CONSTRUCT_DOCTOR_ROOT;
    else process.env.CONSTRUCT_DOCTOR_ROOT = prevDoctorRoot;
  });

  const {
    storageStatus,
    storageReset,
    deleteIngestedArtifactsTool,
  } = await import(`../lib/mcp/server.mjs?storage=${Date.now()}`);
  const { issueApprovalToken } = await import('../lib/mcp/destructive-approval.mjs');

  const status = await storageStatus({ cwd: rootDir });
  assert.equal(status.ingested.count, 1);

  const resetRejected = await storageReset({ cwd: rootDir });
  assert.equal(resetRejected.error, 'storage_reset requires confirm=true');

  const deleteRejected = await deleteIngestedArtifactsTool({ cwd: rootDir });
  assert.equal(deleteRejected.error, 'delete_ingested_artifacts requires confirm=true');

  const deleteConfirmOnly = await deleteIngestedArtifactsTool({ cwd: rootDir, confirm: true });
  assert.match(deleteConfirmOnly.error, /out-of-band approval token/);
  assert.ok(fs.existsSync(brief), 'confirm=true alone must not delete artifacts');

  const token = issueApprovalToken('delete_ingested_artifacts');
  const deleteAccepted = await deleteIngestedArtifactsTool({ cwd: rootDir, confirm: true, approval_token: token });
  assert.equal(deleteAccepted.deletedCount, 1);
});
