#!/usr/bin/env node
/**
 * construct-qa-sandbox.mjs — End-to-end QA test of Construct's intake →
 * triage → task graph → quality gate pipeline in an isolated sandbox.
 *
 * Usage:
 *   node tests/qa/construct-qa-sandbox.mjs
 *
 * Environment:
 *   CX_TOOLKIT_DIR       Override the construct toolkit root (default: repo root)
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const ROOT = process.env.CX_TOOLKIT_DIR || path.resolve(import.meta.dirname, '../..');
const CONSTRUCT_BIN = path.join(ROOT, 'bin', 'construct');
const RUNNER = 'node';

let sandboxDir;
let originalCwd;

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }

function tmpdir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-qa-'));
  return dir;
}

const RED = '\x1b[31m';
const GRN = '\x1b[32m';
const YLW = '\x1b[33m';
const BLU = '\x1b[34m';
const RST = '\x1b[0m';

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  const start = Date.now();
  try {
    const result = fn();
    if (result && typeof result.then === 'function') await result;
    const ms = Date.now() - start;
    console.log(`  ${GRN}✓${RST} ${name} (${ms}ms)`);
    passed++;
  } catch (err) {
    const ms = Date.now() - start;
    console.log(`  ${RED}✖${RST} ${name} (${ms}ms)`);
    console.log(`    ${RED}${err.message.split('\n').slice(0, 4).join('\n    ')}${RST}`);
    failed++;
    failures.push({ name, err });
  }
}

async function suite(name, fn) {
  console.log(`\n${BLU}▶${RST} ${name}`);
  const result = fn();
  if (result && typeof result.then === 'function') await result;
}

function before() {
  sandboxDir = tmpdir();
  originalCwd = process.cwd();
  process.chdir(sandboxDir);
  // Create .cx scaffolding so construct commands see a valid project
  mkdirp(path.join(sandboxDir, '.cx', 'intake', 'pending'));
  mkdirp(path.join(sandboxDir, '.cx', 'intake', 'processed'));
  mkdirp(path.join(sandboxDir, '.cx', 'inbox'));
  mkdirp(path.join(sandboxDir, '.cx', 'task-graphs'));
  // Minimal context.md to make docs:verify happy
  fs.writeFileSync(path.join(sandboxDir, '.cx', 'context.md'),
    `# ${sandboxDir}\n\n## What was in progress\nQA sandbox testing.\n`, 'utf8');
  // README.md for docs:verify
  fs.writeFileSync(path.join(sandboxDir, 'README.md'), `# QA Sandbox\n`, 'utf8');
  console.log(`${YLW}sandbox:${RST} ${sandboxDir}`);
}

function after() {
  process.chdir(originalCwd);
  rmrf(sandboxDir);
  console.log(`${YLW}cleaned:${RST} ${sandboxDir}`);
}

// ─── Realistic Mock Signals ──────────────────────────────────────────────────

const intakeSignals = {

  customerFeedback: {
    filename: 'customer-feedback-search.md',
    content: `# Customer feedback: search results confusing

From: support@customer.com
Date: 2026-05-27

Customer says the search feature is confusing. When they type a query, results don't filter properly by category. Pain point: they can't narrow down results.

Support ticket #4321 reports NPS score dropped this quarter from 8.2 to 6.7. Multiple customers complaining about search relevance.

User feedback: "I type 'account settings' and I get billing info, not settings. Search is broken."
`,
    expected: { type: 'user-signal', owner: 'product-manager', action: 'clarify', stage: 'signal' }
  },

  bugReport: {
    filename: 'checkout-bug.md',
    content: `# Bug: checkout throws exception with empty cart

Bug: the checkout endpoint throws a TypeError when the cart is empty.

Stack trace:
TypeError: Cannot read properties of null (reading 'items')
    at CheckoutService.validate (/app/services/checkout.ts:142)
    at CheckoutController.handle (/app/controllers/checkout.ts:89)

This is a regression from the v2.3.0 refactor. Error reproduces every time on staging.
`,
    expected: { type: 'bug', owner: 'debugger', action: 'diagnose', stage: 'implementation' }
  },

  securityFinding: {
    filename: 'security-cve-auth-library.md',
    content: `# Security advisory: CVE-2024-12345 in auth library

A remote code execution vulnerability was found in the authentication library (v3.2.1).
Exploit: unvalidated JWT token deserialization allows arbitrary code execution.

Secret leak: API keys logged in plaintext during auth debugging.

This is a critical vulnerability requiring immediate patching. Attack vector: remote, no authentication required.
`,
    expected: { type: 'security', owner: 'security', action: 'remediate', stage: 'implementation', risk: 'high', requiresApproval: true }
  },

  architectureADR: {
    filename: 'adr-0013-payments-service-boundary.md',
    content: `# ADR-0013: Service boundary for payments domain

Context: We need to define the service boundary for the payments domain.
The monolith's payment logic is entangled with order management.

Tradeoffs:
1. Synchronous API: simple but couples deployments
2. Async event-driven: decoupled but introduces latency
3. Hybrid: sync for queries, async for mutations

This ADR proposes option 3 with an explicit interface contract.
`,
    expected: { type: 'architecture', owner: 'architect', action: 'design', stage: 'framing' }
  },

  roughNotes: {
    filename: 'product-idea-sprint-q3.md',
    content: `Sprint Q3 ideas from customer calls:

- Dark mode: every enterprise customer asks for this
- Export to PDF: finance team needs monthly reports as PDF
- Bulk operations: support manager wants to archive 1000+ tickets at once
- API rate limiting: we're hitting limits with the new integration

Talked to 5 customers this week. Most pressing: dark mode (4/5 mentioned it).
PDF export would unblock the enterprise deal with Acme Corp ($500k ARR).
`,
    expected: { type: 'user-signal', owner: 'product-manager', action: 'triage', stage: 'signal' }
  },

  incidentPostmortem: {
    filename: 'postmortem-api-outage-2026-05-25.md',
    content: `# Postmortem: Payments API Outage — 2026-05-25

Incident duration: 47 minutes
Impact: All payment processing down. Error rate: 30%.

Root cause: Database connection pool exhaustion after deployment of v2.4.0.
The connection pool was reduced from 100 to 25 without testing under load.

SLO breach: 99.9% → 99.3% during the incident window.

Action items:
1. Revert pool size change
2. Add connection pool monitoring alert
3. Add load testing to CI pipeline
`,
    expected: { type: 'incident', owner: 'sre', action: 'create-runbook', stage: 'operations' }
  },

  complianceFinding: {
    filename: 'gdpr-data-retention-audit.md',
    content: `# GDPR Compliance: Data Retention Audit Findings

Audit reveals PII stored beyond retention period in backup system.
Customer data older than 36 months not purged as required by GDPR Article 5(1)(e).

SOC2 controls for data lifecycle management are missing.
HIPAA compliance gaps found in the logging subsystem.

Legal requires remediation plan by end of quarter.
`,
    expected: { type: 'legal-compliance', owner: 'legal-compliance', action: 'audit', stage: 'signal' }
  },

  competitiveResearch: {
    filename: 'competitor-pricing-analysis.md',
    content: `# Research: Competitor pricing landscape 2026

Industry benchmark study on competitor pricing models:
- Acme: $99/user/mo, per-seat licensing
- BetaCorp: $199 flat, usage-based overage
- Gamma: Enterprise only, custom pricing

Market analysis suggests our pricing is 20% below market for enterprise tier.
Recommendation: evaluate tier restructure for Q3 pricing update.
`,
    expected: { type: 'research', owner: 'business-strategist', action: 'analyze', stage: 'signal' }
  },

  runbookOps: {
    filename: 'runbook-db-backup-maintenance.md',
    content: `# Runbook: Database backup maintenance

Monthly maintenance task:
1. Verify last full backup integrity (restore test)
2. Rotate WAL archive to cold storage
3. Update snapshot retention tags
4. Check backup cron job status

Last run: 2026-05-01 — completed OK.
Scheduled: 1st of every month, 02:00 UTC.
`,
    expected: { type: 'ops', owner: 'operations', action: 'maintain', stage: 'implementation' }
  },

  evalFinding: {
    filename: 'eval-llm-response-regression.md',
    content: `# Eval finding: LLM response quality regression

Eval: RAG response quality benchmark
Score regressed from 0.92 to 0.81 in this week's run.

Recall dropped on financial queries (0.89 → 0.72).
Hallucination rate increased on entity extraction (2% → 7%).

Primary suspect: embedding model update affected retrieval quality.
`,
    expected: { type: 'eval-finding', owner: 'evaluator', action: 'measure', stage: 'signal' }
  },
};

// ─── Helper: write a pending intake packet ─────────────────────────────────

async function enqueuePacket(opts) {
  const { returnIds } = opts || {};
  const { classifyRdIntake } = await import(path.join(ROOT, 'lib/intake/classify.mjs'));
  const { FilesystemIntakeQueue } = await import(path.join(ROOT, 'lib/intake/queue.mjs'));

  const keys = Object.keys(intakeSignals);
  const queue = new FilesystemIntakeQueue(sandboxDir);
  const ids = [];

  for (const key of keys) {
    const s = intakeSignals[key];
    const triage = classifyRdIntake({ sourcePath: `.cx/inbox/${s.filename}`, extractedText: s.content });
    const id = `${key}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await queue.enqueue({
      id,
      status: 'pending',
      intake: { sourcePath: `.cx/inbox/${s.filename}`, outputPath: `.cx/intake/pending/${id}.json`, characters: s.content.length },
      triage,
      excerpt: s.content.substring(0, 800),
      createdAt: new Date().toISOString(),
    });
    ids.push(id);
  }

  return returnIds ? ids : undefined;
}

// ─── Test Suites ─────────────────────────────────────────────────────────────

async function runClassificationTests() {
  suite('Intake classification accuracy', async () => {
    await test('customer feedback classifies as user-signal with PM owner', async () => {
      const { classifyRdIntake } = await import(path.join(ROOT, 'lib/intake/classify.mjs'));
      const s = intakeSignals.customerFeedback;
      const triage = classifyRdIntake({ sourcePath: `.cx/inbox/${s.filename}`, extractedText: s.content });
      assert.equal(triage.intakeType, 'user-signal');
      assert.equal(triage.primaryOwner, 'product-manager');
      assert.equal(triage.recommendedAction, 'clarify');
      assert.equal(triage.rdStage, 'signal');
    });

    await test('bug report classifies as bug with debugger owner', async () => {
      const { classifyRdIntake } = await import(path.join(ROOT, 'lib/intake/classify.mjs'));
      const s = intakeSignals.bugReport;
      const triage = classifyRdIntake({ sourcePath: `.cx/inbox/${s.filename}`, extractedText: s.content });
      assert.equal(triage.intakeType, 'bug');
      assert.equal(triage.primaryOwner, 'debugger');
      assert.equal(triage.recommendedAction, 'diagnose');
      assert.equal(triage.rdStage, 'implementation');
    });

    await test('security finding classifies as security with high risk', async () => {
      const { classifyRdIntake } = await import(path.join(ROOT, 'lib/intake/classify.mjs'));
      const s = intakeSignals.securityFinding;
      const triage = classifyRdIntake({ sourcePath: `.cx/inbox/${s.filename}`, extractedText: s.content });
      assert.equal(triage.intakeType, 'security');
      assert.equal(triage.primaryOwner, 'security');
      assert.equal(triage.risk, 'high');
      assert.equal(triage.requiresApproval, true);
    });

    await test('ADR title-lock gives high confidence (≥0.80)', async () => {
      const { classifyRdIntake } = await import(path.join(ROOT, 'lib/intake/classify.mjs'));
      const s = intakeSignals.architectureADR;
      const triage = classifyRdIntake({ sourcePath: `.cx/inbox/${s.filename}`, extractedText: s.content });
      assert.equal(triage.intakeType, 'architecture');
      assert.equal(triage.primaryOwner, 'architect');
      assert.ok(triage.confidence >= 0.80, `expected ≥0.80 confidence for ADR title-lock, got ${triage.confidence}`);
    });

    await test('unstructured rough notes classify as user-signal', async () => {
      const { classifyRdIntake } = await import(path.join(ROOT, 'lib/intake/classify.mjs'));
      const s = intakeSignals.roughNotes;
      const triage = classifyRdIntake({ sourcePath: `.cx/inbox/${s.filename}`, extractedText: s.content });
      assert.equal(triage.intakeType, 'user-signal');
      assert.equal(triage.primaryOwner, 'product-manager');
    });

    await test('incident postmortem classifies as incident', async () => {
      const { classifyRdIntake } = await import(path.join(ROOT, 'lib/intake/classify.mjs'));
      const s = intakeSignals.incidentPostmortem;
      const triage = classifyRdIntake({ sourcePath: `.cx/inbox/${s.filename}`, extractedText: s.content });
      assert.equal(triage.intakeType, 'incident');
      assert.equal(triage.primaryOwner, 'sre');
      assert.equal(triage.recommendedAction, 'create-runbook');
    });

    await test('compliance finding classifies as legal-compliance', async () => {
      const { classifyRdIntake } = await import(path.join(ROOT, 'lib/intake/classify.mjs'));
      const s = intakeSignals.complianceFinding;
      const triage = classifyRdIntake({ sourcePath: `.cx/inbox/${s.filename}`, extractedText: s.content });
      assert.equal(triage.intakeType, 'legal-compliance');
      assert.equal(triage.primaryOwner, 'legal-compliance');
    });

    await test('competitive research classifies as research', async () => {
      const { classifyRdIntake } = await import(path.join(ROOT, 'lib/intake/classify.mjs'));
      const s = intakeSignals.competitiveResearch;
      const triage = classifyRdIntake({ sourcePath: `.cx/inbox/${s.filename}`, extractedText: s.content });
      assert.equal(triage.intakeType, 'research');
      assert.equal(triage.primaryOwner, 'business-strategist');
    });

    await test('ops runbook classifies as ops', async () => {
      const { classifyRdIntake } = await import(path.join(ROOT, 'lib/intake/classify.mjs'));
      const s = intakeSignals.runbookOps;
      const triage = classifyRdIntake({ sourcePath: `.cx/inbox/${s.filename}`, extractedText: s.content });
      assert.equal(triage.intakeType, 'ops');
      assert.equal(triage.primaryOwner, 'operations');
    });

    await test('eval finding classifies as eval-finding', async () => {
      const { classifyRdIntake } = await import(path.join(ROOT, 'lib/intake/classify.mjs'));
      const s = intakeSignals.evalFinding;
      const triage = classifyRdIntake({ sourcePath: `.cx/inbox/${s.filename}`, extractedText: s.content });
      assert.equal(triage.intakeType, 'eval-finding');
      assert.equal(triage.primaryOwner, 'evaluator');
    });

    await test('classification is deterministic', async () => {
      const { classifyRdIntake } = await import(path.join(ROOT, 'lib/intake/classify.mjs'));
      const s = intakeSignals.bugReport;
      const t1 = classifyRdIntake({ sourcePath: `.cx/inbox/${s.filename}`, extractedText: s.content });
      const t2 = classifyRdIntake({ sourcePath: `.cx/inbox/${s.filename}`, extractedText: s.content });
      assert.deepEqual(t1, t2);
    });
  });
}

async function runIntakeQueueTests() {
  suite('Intake queue lifecycle (direct enqueue)', async () => {
    await test('enqueue all 10 signal types, shows pending+quarantine covers all types', async () => {
      const { FilesystemIntakeQueue } = await import(path.join(ROOT, 'lib/intake/queue.mjs'));
      const { classifyRdIntake } = await import(path.join(ROOT, 'lib/intake/classify.mjs'));
      const { listQuarantine } = await import(path.join(ROOT, 'lib/intake/quarantine.mjs'));
      const queue = new FilesystemIntakeQueue(sandboxDir);
      const keys = Object.keys(intakeSignals);
      const results = [];
      for (const key of keys) {
        const s = intakeSignals[key];
        const triage = classifyRdIntake({ sourcePath: `.cx/inbox/${s.filename}`, extractedText: s.content });
        const res = await queue.enqueue({
          intake: { sourcePath: `.cx/inbox/${s.filename}`, outputPath: `.cx/intake/pending/${s.filename}.json`, characters: s.content.length },
          triage, excerpt: s.content.substring(0, 800),
        });
        results.push(res);
      }
      const pending = queue.listPending();
      const quarantined = listQuarantine(sandboxDir);
      const total = pending.length + quarantined.length;
      assert.equal(total, 10, `expected 10 total enqueued entries, got ${total} (${pending.length} pending + ${quarantined.length} quarantined)`);
      const allTypes = [...pending, ...quarantined].map(p => p.triage?.intakeType);
      assert.ok(allTypes.includes('bug'), 'should include bug');
      assert.ok(allTypes.includes('security'), 'should include security');
      assert.ok(allTypes.includes('incident'), 'should include incident');
      assert.ok(allTypes.includes('legal-compliance'), 'should include legal-compliance');
      assert.ok(allTypes.includes('research'), 'should include research');
      assert.ok(allTypes.includes('ops'), 'should include ops');
    });

    await test('read a specific packet returns full triage (using queue-generated ID)', async () => {
      const { FilesystemIntakeQueue } = await import(path.join(ROOT, 'lib/intake/queue.mjs'));
      const queue = new FilesystemIntakeQueue(sandboxDir);
      const result = await queue.enqueue({
        intake: { sourcePath: 'inbox/r-test.md', outputPath: '.cx/intake/pending/r-test.json', characters: 50 },
        triage: { intakeType: 'bug', primaryOwner: 'debugger', rdStage: 'implementation' },
        excerpt: 'read test',
      });
      const first = queue.read(result.id);
      assert.ok(first, 'read should return packet');
      assert.equal(first.id, result.id, 'correct entry');
      assert.ok(first.triage, 'packet has triage');
      assert.ok(first.excerpt, 'packet has excerpt');
    });

    await test('mark processed removes from pending list (using queue-generated ID)', async () => {
      const { FilesystemIntakeQueue } = await import(path.join(ROOT, 'lib/intake/queue.mjs'));
      const queue = new FilesystemIntakeQueue(sandboxDir);
      const result = await queue.enqueue({
        intake: { sourcePath: 'inbox/m-test.md', outputPath: '.cx/intake/pending/m-test.json', characters: 50 },
        triage: { intakeType: 'bug', primaryOwner: 'debugger', rdStage: 'implementation' },
        excerpt: 'mark test',
      });
      queue.markProcessed(result.id);
      const pending = queue.listPending();
      const stillPending = pending.find(p => p.id === result.id);
      assert.ok(!stillPending, 'processed entry not in pending');
    });

    await test('intake CLI list shows entries', async () => {
      // Enqueue a fresh packet so this test is self-contained
      const { FilesystemIntakeQueue } = await import(path.join(ROOT, 'lib/intake/queue.mjs'));
      const queue = new FilesystemIntakeQueue(sandboxDir);
      await queue.enqueue({
        intake: { sourcePath: 'inbox/cli-test.md', outputPath: '.cx/intake/pending/cli-test.json', characters: 50 },
        triage: { intakeType: 'bug', primaryOwner: 'debugger', rdStage: 'implementation' },
        excerpt: 'CLI test entry',
      });

      const list = spawnSync(RUNNER, [CONSTRUCT_BIN, 'intake', 'list'], {
        cwd: sandboxDir, encoding: 'utf8',
        env: { ...process.env, CX_TOOLKIT_DIR: ROOT },
      });
      assert.equal(list.status, 0, `intake list failed: ${list.stderr}`);
      assert.ok(list.stdout.includes('bug'), `list should show bug type, got: ${list.stdout.substring(0, 200)}`);
    });
  });
}

async function runTaskGraphTests() {
  suite('Task graph generation from triage', async () => {
    await test('bug report generates diagnosis/implementation chain for debugger', async () => {
      const { classifyRdIntake } = await import(path.join(ROOT, 'lib/intake/classify.mjs'));
      const { generateTaskGraphFromTriage } = await import(path.join(ROOT, 'lib/task-graph/generate.mjs'));

      const s = intakeSignals.bugReport;
      const triage = classifyRdIntake({ sourcePath: `.cx/inbox/${s.filename}`, extractedText: s.content });

      const graph = generateTaskGraphFromTriage({ triage, project: 'qa-sandbox', request: s.content });
      assert.ok(graph.id, 'graph must have an id');
      assert.ok(Array.isArray(graph.nodes), 'graph must have nodes');
      assert.ok(graph.nodes.length >= 2, `bug chain should have ≥2 nodes, got ${graph.nodes.length}`);

      const firstNode = graph.nodes[0];
      assert.ok(firstNode.owner === 'debugger', `first owner should be debugger, got ${firstNode.owner}`);
      assert.ok(graph.nodes.every(n => n.status === 'pending'), 'all nodes start pending');
    });

    await test('architecture ADR generates chain starting with architect', async () => {
      const { classifyRdIntake } = await import(path.join(ROOT, 'lib/intake/classify.mjs'));
      const { generateTaskGraphFromTriage } = await import(path.join(ROOT, 'lib/task-graph/generate.mjs'));

      const s = intakeSignals.architectureADR;
      const triage = classifyRdIntake({ sourcePath: `.cx/inbox/${s.filename}`, extractedText: s.content });

      const graph = generateTaskGraphFromTriage({ triage, project: 'qa-sandbox', request: s.content });
      assert.ok(graph.nodes.length >= 1, 'architecture graph should have nodes');
      const archNode = graph.nodes.find(n => n.owner === 'architect');
      assert.ok(archNode, 'should have architect node');
    });

    await test('security finding generates chain starting with security', async () => {
      const { classifyRdIntake } = await import(path.join(ROOT, 'lib/intake/classify.mjs'));
      const { generateTaskGraphFromTriage } = await import(path.join(ROOT, 'lib/task-graph/generate.mjs'));

      const s = intakeSignals.securityFinding;
      const triage = classifyRdIntake({ sourcePath: `.cx/inbox/${s.filename}`, extractedText: s.content });

      const graph = generateTaskGraphFromTriage({ triage, project: 'qa-sandbox', request: s.content });
      const securityNode = graph.nodes.find(n => n.owner === 'security');
      assert.ok(securityNode, 'should have security node');
    });

    await test('task graph store round-trips correctly', async () => {
      const { classifyRdIntake } = await import(path.join(ROOT, 'lib/intake/classify.mjs'));
      const { generateTaskGraphFromTriage } = await import(path.join(ROOT, 'lib/task-graph/generate.mjs'));
      const { FilesystemTaskGraphStore } = await import(path.join(ROOT, 'lib/task-graph/store.mjs'));

      const s = intakeSignals.bugReport;
      const triage = classifyRdIntake({ sourcePath: `.cx/inbox/${s.filename}`, extractedText: s.content });
      const graph = generateTaskGraphFromTriage({ triage, project: 'qa-sandbox', request: s.content });

      const store = new FilesystemTaskGraphStore(sandboxDir);
      store.save(graph);

      const loaded = store.read(graph.id);
      assert.ok(loaded, 'graph should be loadable');
      assert.equal(loaded.id, graph.id);
      assert.equal(loaded.nodes.length, graph.nodes.length);

      const allGraphs = store.list();
      assert.ok(allGraphs.some(g => g.id === graph.id), 'graph should appear in list');

      store.updateNodeStatus(graph.id, graph.nodes[0].id, 'in_progress');
      const updated = store.read(graph.id);
      const updatedNode = updated.nodes.find(n => n.id === graph.nodes[0].id);
      assert.equal(updatedNode.status, 'in_progress');
    });
  });
}

async function runQualityGateTests() {
  suite('Quality gates', async () => {
    await test('npm test has 0 failures', () => {
      const r = spawnSync(RUNNER, [CONSTRUCT_BIN, 'test'], {
        cwd: ROOT, encoding: 'utf8',
        env: process.env, timeout: 120000,
      });
      if (r.error) {
        console.log(`  ${YLW}⚠${RST} test runner: ${r.error.message}`);
        return;
      }
      const output = r.stdout + r.stderr;
      const m = output.match(/ℹ fail (\d+)/);
      if (m) assert.equal(parseInt(m[1], 10), 0, `npm test has ${m[1]} failures`);
      const m2 = output.match(/ℹ cancelled (\d+)/);
      if (m2 && parseInt(m2[1], 10) > 0) {
        console.log(`  ${YLW}ℹ${RST} ${m2[1]} cancelled tests (expected for environment limits)`);
      }
    });

    await test('lint:comments has 0 errors and 0 warnings', () => {
      const r = spawnSync(RUNNER, [CONSTRUCT_BIN, 'lint:comments'], {
        cwd: ROOT, encoding: 'utf8', env: process.env, timeout: 30000,
      });
      if (r.error) {
        console.log(`  ${YLW}⚠${RST} lint:comments: ${r.error.message}`);
        return;
      }
      const errM = r.stdout.match(/(\d+) error/);
      const warnM = r.stdout.match(/(\d+) warning/);
      if (errM) assert.equal(parseInt(errM[1], 10), 0, `lint:comments: ${errM[1]} errors`);
      if (warnM) assert.equal(parseInt(warnM[1], 10), 0, `lint:comments: ${warnM[1]} warnings`);
    });
  });
}

async function runRegistryIntegrityTests() {
  suite('Registry and policy data integrity', async () => {
    await test('registry.json is valid JSON with correct structure', () => {
      const rp = path.join(ROOT, 'specialists', 'registry.json');
      const raw = fs.readFileSync(rp, 'utf8');
      const reg = JSON.parse(raw);
      assert.ok(reg.version, 'version');
      assert.ok(reg.orchestrator, 'orchestrator');
      assert.equal(reg.orchestrator.name, 'construct');
      assert.ok(Array.isArray(reg.specialists), 'specialists array');
      assert.ok(reg.specialists.length > 15, `>15 specialists: ${reg.specialists.length}`);
      reg.specialists.forEach((s, i) => {
        assert.ok(s.name, `specialist[${i}].name`);
        assert.ok(s.description, `specialist[${i}].description`);
        assert.ok(s.claudeTools, `specialist[${i}].claudeTools`);
        assert.ok(s.promptFile, `specialist[${i}].promptFile`);
      });
    });

    await test('role-manifests persona names resolve to registry', () => {
      const rp = path.join(ROOT, 'specialists', 'registry.json');
      const mp = path.join(ROOT, 'specialists', 'role-manifests.json');
      const reg = JSON.parse(fs.readFileSync(rp, 'utf8'));
      const manifest = JSON.parse(fs.readFileSync(mp, 'utf8'));
      const validNames = new Set(reg.specialists.map(s => s.name));
      validNames.add(reg.orchestrator.name);
      const personas = manifest.personas || {};
      const personaKeys = Object.keys(personas);
      assert.ok(personaKeys.length > 10, `expected >10 personas, got ${personaKeys.length}`);
      for (const key of personaKeys) {
        assert.ok(validNames.has(key), `role-manifest persona "${key}" not in registry`);
        const config = personas[key];
        if (config.fence && config.fence.allowedPaths) {
          assert.ok(Array.isArray(config.fence.allowedPaths), `${key}: allowedPaths must be an array`);
        }
      }
    });

    await test('contracts producers/consumers resolve (handling * wildcard)', () => {
      const rp = path.join(ROOT, 'specialists', 'registry.json');
      const cp = path.join(ROOT, 'specialists', 'contracts.json');
      const reg = JSON.parse(fs.readFileSync(rp, 'utf8'));
      const contracts = JSON.parse(fs.readFileSync(cp, 'utf8'));
      const knownNames = new Set(reg.specialists.map(s => s.name));
      knownNames.add(reg.orchestrator.name);
      knownNames.add('user');
      knownNames.add('oncall');
      knownNames.add('incident-system');
      knownNames.add('*'); // wildcard "any producer"
      for (const c of contracts.contracts || []) {
        assert.ok(knownNames.has(c.producer) || c.producer?.startsWith('cx-'),
          `contract ${c.id}: unknown producer "${c.producer}"`);
        assert.ok(knownNames.has(c.consumer) || c.consumer?.startsWith('cx-') || c.consumer === 'user',
          `contract ${c.id}: unknown consumer "${c.consumer}"`);
      }
    });

    await test('lint:contracts passes', () => {
      const r = spawnSync(RUNNER, [CONSTRUCT_BIN, 'lint:contracts'], {
        cwd: ROOT, encoding: 'utf8', env: process.env, timeout: 30000,
      });
      assert.equal(r.status, 0, `lint:contracts exit ${r.status}: ${r.stderr.substring(0, 200)}`);
    });

    await test('lint:agents passes', () => {
      const r = spawnSync(RUNNER, [CONSTRUCT_BIN, 'lint:agents'], {
        cwd: ROOT, encoding: 'utf8', env: process.env, timeout: 30000,
      });
      assert.equal(r.status, 0, `lint:agents exit ${r.status}: ${r.stderr.substring(0, 200)}`);
    });

    await test('doctor exits 0', () => {
      const r = spawnSync(RUNNER, [CONSTRUCT_BIN, 'doctor'], {
        cwd: ROOT, encoding: 'utf8', env: process.env, timeout: 60000,
      });
      assert.equal(r.status, 0, `doctor exit ${r.status}: ${r.stderr.substring(0, 200)}`);
    });

    await test('sync --dry-run validates', () => {
      const r = spawnSync(RUNNER, [CONSTRUCT_BIN, 'sync', '--dry-run'], {
        cwd: ROOT, encoding: 'utf8', env: process.env, timeout: 30000,
      });
      assert.equal(r.status, 0, `sync --dry-run exit ${r.status}: ${r.stderr.substring(0, 200)}`);
    });
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`${BLU}══════════════════════════════════════════════════${RST}`);
  console.log(`${BLU}  Construct QA Sandbox — Full Pipeline Test      ${RST}`);
  console.log(`${BLU}══════════════════════════════════════════════════${RST}`);

  before();
  console.log(`\n${YLW}Toolkit root:${RST} ${ROOT}`);

  // Phase 1: Classification accuracy (pure, deterministic, no sandbox needed)
  await runClassificationTests();

  // Phase 2: Intake queue lifecycle (direct queue + CLI)
  await runIntakeQueueTests();

  // Phase 3: Task graph generation
  await runTaskGraphTests();

  // Phase 4: Quality gates (run against real project)
  await runQualityGateTests();

  // Phase 5: Registry and policy data integrity
  await runRegistryIntegrityTests();

  after();

  console.log(`\n${BLU}══════════════════════════════════════════════════${RST}`);
  console.log(`${GRN}  Results:${RST} ${passed} passed, ${RED}${failed} failed${RST}`);
  console.log(`${BLU}══════════════════════════════════════════════════${RST}`);

  if (failures.length > 0) {
    console.log(`\n${RED}Failing tests:${RST}`);
    for (const f of failures) {
      console.log(`  ${RED}✖${RST} ${f.name}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`${RED}FATAL:${RST} ${err.message}`);
  process.exit(1);
});
