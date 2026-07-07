/**
 * tests/orchestration-policy-task-graph.test.mjs
 *
 * Pins Tier 1 sub-bead 2: when orchestration_policy receives an intakeId,
 * the response carries a task graph generated from that packet's triage,
 * persisted under .cx/task-graphs/, with a task_graph.created trace event
 * whose traceId correlates to the originating intake.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { orchestrationPolicy } from '../lib/mcp/tools/skills.mjs';
import { FilesystemIntakeQueue } from '../lib/intake/queue.mjs';
import { classifyRdIntake } from '../lib/intake/classify.mjs';
import { traceDir } from '../lib/worker/trace.mjs';

let projectRoot;
let originalCwd;
let originalHome;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-orch-graph-'));
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  // Mark the tmpdir as a Construct project so intent-verifications,
  // skill-calls, and friends write into <projectRoot>/.cx/ instead of
  // leaking into the dev box's real ~/.cx/. Set HOME too so any cross-
  // project writer fallback also lands in the sandbox.

  fs.mkdirSync(path.join(projectRoot, '.construct'), { recursive: true });
  process.env.HOME = projectRoot;
  process.chdir(projectRoot);
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

function seedIntake(text) {
  const queue = new FilesystemIntakeQueue(projectRoot);
  const triage = classifyRdIntake({ sourcePath: '/inbox/test.md', extractedText: text });
  return queue.enqueue({
    intake: { sourcePath: '/inbox/test.md', outputPath: '/inbox/test.md', characters: text.length, knowledgeSubdir: 'reference' },
    triage,
    suggestion: null,
    related: [],
    excerpt: text.slice(0, 240),
    query: 'test',
  });
}

describe('orchestrationPolicy intakeId auto-generates task graph', () => {
  it('omits taskGraph when no intakeId is supplied', async () => {
    const result = await orchestrationPolicy({
      request: 'implement a new feature in the auth subsystem',
      fileCount: 5,
      moduleCount: 3,
    });
    assert.equal(result.taskGraph, undefined);
    assert.equal(result.intakeError, undefined);
  });

  it('generates a task graph from a bug intake packet', async () => {
    const { id: intakeId } = seedIntake('Stack trace on the login redirect. Reproduce: open /auth, click sign-in.');

    const result = await orchestrationPolicy({
      request: 'fix the login bug',
      fileCount: 5,
      moduleCount: 3,
      intakeId,
    });

    assert.ok(result.taskGraph, 'taskGraph attached to response');
    assert.deepEqual(result.taskGraph.nodes.map((n) => n.owner), ['debugger', 'engineer', 'qa', 'reviewer']);
    assert.equal(result.taskGraph.triage.intakeType, 'bug');
    assert.equal(typeof result.taskGraph.traceId, 'string');
    assert.match(result.taskGraph.traceId, /^trace-/);
  });

  it('persists the generated graph to .cx/task-graphs/', async () => {
    const { id: intakeId } = seedIntake('CVE-2026-1234: SQLi in the search endpoint. Vulnerability disclosure deadline next week.');
    const result = await orchestrationPolicy({
      request: 'address the CVE disclosure',
      fileCount: 3,
      moduleCount: 2,
      intakeId,
    });
    assert.ok(result.taskGraph);
    const graphFile = path.join(projectRoot, '.construct', 'task-graphs', `${result.taskGraph.id}.json`);
    assert.ok(fs.existsSync(graphFile), 'graph persisted to disk');
    const persisted = JSON.parse(fs.readFileSync(graphFile, 'utf8'));
    assert.deepEqual(persisted.nodes.map((n) => n.owner), ['security', 'engineer', 'reviewer']);
  });

  it('emits task_graph.created trace event with caller-supplied traceId', async () => {
    const { id: intakeId } = seedIntake('Incident: P0 outage, 5xx for 12 minutes, PagerDuty fired.');
    const traceId = 'trace-validation-1';
    await orchestrationPolicy({
      request: 'incident response',
      fileCount: 4,
      moduleCount: 2,
      intakeId,
      traceId,
    });
    const dir = traceDir(projectRoot);
    const files = fs.readdirSync(dir);
    const events = fs.readFileSync(path.join(dir, files[0]), 'utf8').trim().split('\n').map(JSON.parse);
    const event = events.find((e) => e.eventType === 'task_graph.created' && e.traceId === traceId);
    assert.ok(event, 'task_graph.created event was emitted with the supplied traceId');
    assert.equal(event.intakeId, intakeId);
    assert.equal(event.metadata.intakeType, 'incident');
    assert.equal(event.metadata.chain.length, 3);
  });

  it('returns intakeError for unknown intakeId without throwing', async () => {
    const result = await orchestrationPolicy({
      request: 'something',
      fileCount: 5,
      moduleCount: 3,
      intakeId: 'nonexistent-packet',
    });
    assert.equal(result.taskGraph, undefined);
    assert.match(result.intakeError, /not found/);
  });
});
