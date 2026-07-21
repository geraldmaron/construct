/**
 * tests/task-graph.test.mjs — task graph schema + generation + persistence.
 *
 * Pins the contract: triage → workflow template → graph nodes follow the
 * recommendedChain, depends_on edges chain owner-by-owner, acceptance
 * criteria seed from the rdStage, verification requirements ride along,
 * the filesystem store round-trips a graph, and node status updates
 * preserve evidence.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { generateTaskGraphFromTriage } from '../lib/task-graph/generate.mjs';
import { validateGraph, validateNode, NODE_STATUSES, EDGE_TYPES } from '../lib/task-graph/schema.mjs';
import { FilesystemTaskGraphStore, storeDir } from '../lib/task-graph/store.mjs';
import { classifyRdIntake } from '../lib/intake/classify.mjs';

let projectRoot;
let store;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-task-graph-'));
  store = new FilesystemTaskGraphStore(projectRoot);
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

function bugTriage() {
  return classifyRdIntake({
    sourcePath: '/tmp/login-stack.md',
    extractedText: 'Stack trace on the login redirect. Reproduce: open /auth, click sign-in.',
  });
}

describe('schema', () => {
  it('lists the canonical status and edge types', () => {
    assert.ok(NODE_STATUSES.includes('pending'));
    assert.ok(NODE_STATUSES.includes('done'));
    assert.ok(NODE_STATUSES.includes('blocked'));
    assert.ok(NODE_STATUSES.includes('needs-input'));
    assert.ok(EDGE_TYPES.includes('depends_on'));
    assert.ok(EDGE_TYPES.includes('handoff_to'));
    assert.ok(EDGE_TYPES.includes('supersedes'));
  });

  it('validateNode flags missing required fields', () => {
    const errors = validateNode({ title: 'x' });
    assert.ok(errors.length > 0);
  });

  it('validateGraph catches dangling dependsOn', () => {
    const graph = {
      id: 'g1',
      nodes: [
        { id: 'a', project: 'p', title: 't', type: 'implementation', owner: 'engineer', status: 'pending', dependsOn: ['missing'] },
      ],
    };
    const errors = validateGraph(graph);
    assert.ok(errors.some((e) => /dependsOn references unknown/.test(e)));
  });
});

describe('generateTaskGraphFromTriage', () => {
  it('produces one node per persona in recommendedChain', () => {
    const triage = bugTriage();
    const graph = generateTaskGraphFromTriage({ triage, project: 'demo' });
    assert.equal(graph.nodes.length, triage.recommendedChain.length);
    assert.deepEqual(graph.nodes.map((n) => n.owner), triage.recommendedChain);
  });

  it('chains nodes with depends_on edges in order', () => {
    const triage = bugTriage();
    const graph = generateTaskGraphFromTriage({ triage, project: 'demo' });
    for (let i = 1; i < graph.nodes.length; i++) {
      assert.deepEqual(graph.nodes[i].dependsOn, [graph.nodes[i - 1].id]);
    }
    const handoffs = graph.edges.filter((e) => e.type === 'handoff_to');
    assert.equal(handoffs.length, graph.nodes.length - 1);
  });

  it('seeds acceptance criteria from the rdStage', () => {
    const triage = bugTriage();
    const graph = generateTaskGraphFromTriage({ triage });
    for (const node of graph.nodes) {
      assert.ok(node.acceptanceCriteria.length >= 1, `acceptance criteria for ${node.owner}`);
    }
  });

  it('seeds verificationRequirements for implementation-stage graphs', () => {
    const triage = bugTriage();
    const graph = generateTaskGraphFromTriage({ triage });
    assert.ok(graph.verificationRequirements.includes('npm test'));
  });

  it('persists the intake on node 1 inputs for traceability', () => {
    const triage = bugTriage();
    const graph = generateTaskGraphFromTriage({
      triage,
      intake: { sourcePath: '/tmp/login.md' },
    });
    assert.equal(graph.nodes[0].inputs[0].kind, 'intake');
    assert.equal(graph.nodes[0].inputs[0].sourcePath, '/tmp/login.md');
  });

  it('passes schema validation', () => {
    const triage = bugTriage();
    const graph = generateTaskGraphFromTriage({ triage, project: 'demo' });
    const errors = validateGraph(graph);
    assert.deepEqual(errors, [], `graph should validate; errors: ${errors.join('; ')}`);
  });

  it('covers the bug workflow (debugger → engineer → qa → reviewer)', () => {
    const graph = generateTaskGraphFromTriage({ triage: bugTriage() });
    assert.deepEqual(graph.nodes.map((n) => n.owner), ['debugger', 'engineer', 'qa', 'reviewer']);
    assert.equal(graph.nodes[0].type, 'diagnosis');
    assert.equal(graph.nodes[2].type, 'verification');
    assert.equal(graph.nodes[3].type, 'review');
  });

  it('covers the experiment workflow (rd-lead → researcher → evaluator)', () => {
    const triage = classifyRdIntake({
      sourcePath: '/tmp/hyp.md',
      extractedText: 'Hypothesis: prompt caching cuts latency. Spike with a falsifiable success metric.',
    });
    const graph = generateTaskGraphFromTriage({ triage });
    assert.deepEqual(graph.nodes.map((n) => n.owner), ['rd-lead', 'researcher', 'evaluator']);
  });

  it('covers the architecture workflow (architect → devil-advocate → engineer)', () => {
    const triage = classifyRdIntake({
      sourcePath: '/tmp/adr.md',
      extractedText: 'ADR draft: tradeoff between Postgres queue and a broker. Interface contract for workers.',
    });
    const graph = generateTaskGraphFromTriage({ triage });
    assert.deepEqual(graph.nodes.map((n) => n.owner), ['architect', 'devil-advocate', 'engineer']);
    assert.equal(graph.nodes[0].type, 'design');
  });

  it('covers the eval-finding workflow (evaluator → ai-engineer → trace-reviewer)', () => {
    const triage = classifyRdIntake({
      sourcePath: '/tmp/eval.md',
      extractedText: 'Recall@5 dropped; trace shows hallucination. Judge rubric needs an update.',
    });
    const graph = generateTaskGraphFromTriage({ triage });
    assert.deepEqual(graph.nodes.map((n) => n.owner), ['evaluator', 'ai-engineer', 'trace-reviewer']);
    assert.equal(graph.nodes[0].type, 'evaluation');
  });

  it('throws when triage is missing', () => {
    assert.throws(() => generateTaskGraphFromTriage({}), /triage is required/);
  });
});

describe('FilesystemTaskGraphStore', () => {
  it('save → read round-trips the full graph', () => {
    const graph = generateTaskGraphFromTriage({ triage: bugTriage(), project: 'demo' });
    store.save(graph);
    const r = store.read(graph.id);
    assert.deepEqual(r, graph);
  });

  it('list returns graphs in createdAt order', async () => {
    store.save(generateTaskGraphFromTriage({ triage: bugTriage() }));
    await new Promise((res) => setTimeout(res, 5));
    store.save(generateTaskGraphFromTriage({ triage: bugTriage() }));
    const all = store.list();
    assert.equal(all.length, 2);
    assert.ok(all[0].createdAt <= all[1].createdAt);
  });

  it('writes graphs under .construct/task-graphs/', () => {
    const graph = generateTaskGraphFromTriage({ triage: bugTriage() });
    store.save(graph);
    const dir = storeDir(projectRoot);
    assert.ok(fs.existsSync(dir));
    assert.ok(fs.existsSync(path.join(dir, `${graph.id}.json`)));
  });

  it('updateNodeStatus appends evidence and bumps updatedAt', () => {
    const graph = generateTaskGraphFromTriage({ triage: bugTriage() });
    store.save(graph);
    const node = store.updateNodeStatus(graph.id, graph.nodes[0].id, 'in-progress', {
      addEvidence: 'reproduce captured at trace://abc',
    });
    assert.equal(node.status, 'in-progress');
    assert.equal(node.evidence.length, 1);
    const fresh = store.read(graph.id);
    assert.equal(fresh.nodes[0].status, 'in-progress');
    assert.equal(fresh.nodes[0].evidence[0], 'reproduce captured at trace://abc');
  });

  it('throws clearly on missing graph or node', () => {
    assert.throws(() => store.updateNodeStatus('nope', 'x', 'done'), /not found/);
    const graph = generateTaskGraphFromTriage({ triage: bugTriage() });
    store.save(graph);
    assert.throws(() => store.updateNodeStatus(graph.id, 'missing-node', 'done'), /not found/);
  });
});
