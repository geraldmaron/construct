/**
 * tests/kernel/broker/evidence-worktree.test.ts — a session in a linked git
 * worktree cites what its own checkout holds, and every receipt is the bytes
 * it observed, wherever it is checked from.
 *
 * A managed run is submitted from a real linked worktree, citing a file only
 * that worktree has and a file both checkouts hold with different bytes. The
 * receipts name the worktree and its commit. Verification runs through the
 * CLI in the worktree, and the run's evidence is rechecked from the main
 * checkout the way delivery settlement checks it: the worktree's bytes
 * satisfy their receipts, the main checkout's different bytes never do, and
 * a changed file is stale from every checkout. A receipt that names a
 * directory outside the project is never consulted. Everything runs against
 * a real repository in a sterile temp directory.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sterile, type SterileFixture } from '../../harness/sterile.ts';
import { TOOLS } from '../../../src/kernel/broker/tools.ts';
import { record } from '../../../src/kernel/broker/definition.ts';
import { createBrokerContext, type BrokerBinding } from '../../../src/cli/broker-context.ts';
import { createContext, openProject, type CliContext } from '../../../src/cli/context.ts';
import { run as cli } from '../../../src/cli/index.ts';
import { initializeProject } from '../../../src/kernel/project/initialize.ts';
import { textDigest } from '../../../src/kernel/project/evidence.ts';
import { createSkillRegistry } from '../../../src/kernel/registry/skill-registry.ts';
import { createWorkflowRegistry } from '../../../src/kernel/registry/workflow-registry.ts';
import { updateLock } from '../../../src/kernel/registry/lockfile.ts';
import { writeJsonFile } from '../../../src/kernel/project/files.ts';
import { checkoutResolver } from '../../../src/kernel/source/resolver.ts';
import { getStep } from '../../../src/kernel/state/steps.ts';
import {
  currentReceipt,
  runExecutionProblems,
  staleReceiptSubjects,
  type VerificationReceipt,
} from '../../../src/kernel/workflow/verification.ts';
import type { BrokerContext } from '../../../src/kernel/broker/context.ts';
import { syntheticSemanticAdapter } from '../workflow/semantic-fixture.ts';
import { capture } from '../../cli/support.ts';

const LANE_ONLY = 'The lane keeps 42 parsers.\n';
const SHARED_MAIN = 'Shared notes as the main checkout has them: 7 lanes.\n';
const SHARED_LANE = 'Shared notes as the worktree has them: 9 lanes.\n';

function gitEnv(fx: SterileFixture): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: join(fx.root, 'home'),
    XDG_CONFIG_HOME: fx.paths.configDir,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
}

interface Repo {
  readonly fx: SterileFixture;
  readonly main: string;
  readonly lane: string;
  readonly laneHead: string;
  context(cwd: string): CliContext;
  session(cwd: string, sessionId: string): BrokerContext;
  cleanup(): void;
}

/** A repository with a Construct project and one linked worktree whose branch adds and changes files the main checkout does not have. */
function repo(): Repo {
  const fx = sterile();
  mkdirSync(join(fx.root, 'home'), { recursive: true });
  const main = join(realpathSync(fx.root), 'repo');
  mkdirSync(join(main, 'docs'), { recursive: true });
  const git = (cwd: string, args: string[]): string => {
    const r = spawnSync('git', args, { cwd, env: gitEnv(fx), encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stdout}${r.stderr}`);
    return r.stdout.trim();
  };
  git(main, ['init', '-q', '-b', 'main']);
  writeFileSync(join(main, 'docs', 'shared.md'), SHARED_MAIN);
  writeFileSync(join(main, '.gitignore'), '.claude/worktrees/\n');
  const init = initializeProject({ root: main, projectId: 'proj-evidence-lanes', name: 'evidence lanes', at: '2026-10-17T12:00:00.000Z' });
  const skills = createSkillRegistry({ projectDir: init.layout.skillsDir });
  const workflows = createWorkflowRegistry({ projectDir: init.layout.workflowsDir });
  writeJsonFile(init.layout.lockFile, updateLock(init.lock, skills.list(), workflows.list()).lock);
  init.store.close();
  git(main, ['add', '.']);
  git(main, ['commit', '-q', '-m', 'start']);
  const lane = join(main, '.claude', 'worktrees', 'lane');
  git(main, ['worktree', 'add', '-q', '-b', 'feat/lane', lane]);
  mkdirSync(join(lane, 'notes'));
  writeFileSync(join(lane, 'notes', 'lane-only.md'), LANE_ONLY);
  writeFileSync(join(lane, 'docs', 'shared.md'), SHARED_LANE);
  git(lane, ['add', '.']);
  git(lane, ['commit', '-q', '-m', 'lane work']);
  const laneHead = git(lane, ['rev-parse', 'HEAD']);

  let t = Date.parse('2026-10-17T12:00:00.000Z');
  let n = 0;
  const clock = (): string => new Date((t += 1000)).toISOString();
  const ids = (prefix: string): string => `${prefix}-${String(++n).padStart(4, '0')}`;
  const env: NodeJS.ProcessEnv = {
    HOME: join(fx.root, 'home'),
    XDG_CONFIG_HOME: fx.paths.configDir,
    XDG_STATE_HOME: fx.paths.stateDir,
    XDG_DATA_HOME: fx.paths.dataDir,
    XDG_CACHE_HOME: fx.paths.cacheDir,
    PATH: process.env.PATH,
  };
  const context = (cwd: string): CliContext => ({ ...createContext(cwd, env), now: clock, nextId: ids });
  const opened: BrokerContext[] = [];
  const session = (cwd: string, sessionId: string): BrokerContext => {
    const ctx = context(cwd);
    const project = openProject(ctx);
    const binding: BrokerBinding = {
      client: 'claude-code',
      surface: 'interactive',
      sessionId,
      executorId: `session:claude-code:${sessionId}`,
      actor: 'model via claude-code',
    };
    const raw = createBrokerContext(ctx, project, binding);
    const broker = { ...raw, workflow: syntheticSemanticAdapter(raw.workflow, project.store, clock) };
    opened.push(broker);
    return broker;
  };
  return {
    fx,
    main,
    lane,
    laneHead,
    context,
    session,
    cleanup: () => {
      for (const b of opened) b.store.close();
      fx.cleanup();
    },
  };
}

/** The JSON document a command wrote last; the test runner's own events share the captured stream. */
function lastJson(out: string): any {
  for (let at = out.lastIndexOf('{"'); at >= 0; at = out.lastIndexOf('{"', at - 1)) {
    try {
      return JSON.parse(out.slice(at));
    } catch {
      // An object nested inside the document, or the runner's bytes before it.
    }
  }
  throw new Error(`no JSON document in ${JSON.stringify(out.slice(-200))}`);
}

async function call(ctx: BrokerContext, name: string, args: Record<string, unknown>): Promise<any> {
  const tool = TOOLS.find((t) => t.name === name)!;
  return await tool.run(ctx, tool.validate(record(args)));
}

test('a worktree session cites its own files, verifies there, and every checkout holds its receipts to the bytes observed', async () => {
  const r = repo();
  try {
    const here = r.session(r.lane, 'ses_lane');
    assert.equal(here.lane?.root, r.lane, 'the session works in the worktree');
    const started = here.workflow.start({
      workflowId: 'managed-outcome',
      input: { request: 'Write a parser note from the lane notes' },
      trigger: 'manual',
    });
    const runId = started.run.id;
    const claim = async () => (await call(here, 'claim_work', { runId })).work;
    const submit = async (work: any, output: unknown, evidence: unknown[] = []) =>
      call(here, 'submit_work', { stepRunId: work.stepRunId, token: work.token, output, evidence });

    await submit(await claim(), { plan: ['Read the lane notes and write the parser note'], assumptions: [], blockers: [] });
    writeFileSync(join(r.lane, 'note.md'), 'The lane keeps 42 parsers, and the worktree notes count 9 lanes.\n');
    const written = await submit(
      await claim(),
      { summary: 'Parser note written', findings: ['The lane keeps 42 parsers'], changes: ['note.md'], artifact: 'note.md' },
      [{ ref: 'notes/lane-only.md' }, { ref: 'docs/shared.md' }],
    );
    assert.equal(written.step.state, 'succeeded', JSON.stringify(written.validation));

    const receipt = (getStep(here.store, written.step.id)!.output as { verificationReceipt: VerificationReceipt }).verificationReceipt;
    const laneOnly = receipt.evidence.find((e) => e.ref === 'notes/lane-only.md')!;
    const shared = receipt.evidence.find((e) => e.ref === 'docs/shared.md')!;
    assert.equal(laneOnly.digest, textDigest(LANE_ONLY));
    assert.equal(shared.digest, textDigest(SHARED_LANE), 'a bare path names the bytes in the session’s own checkout');
    for (const e of [laneOnly, shared]) {
      assert.equal(e.checkout, r.lane, 'the receipt names the checkout it read');
      assert.equal(e.commit, r.laneHead, 'and that checkout’s commit');
    }

    // Verification through the CLI, from the worktree: the command runs there and binds the worktree's artifact.
    const work = await claim();
    const verified = await capture(() =>
      cli(
        [
          'run',
          'verify',
          runId,
          '--step',
          work.stepRunId,
          '--token',
          String(work.token),
          '--command',
          JSON.stringify([
            process.execPath,
            '-e',
            'require("node:assert/strict").match(require("node:fs").readFileSync("note.md","utf8"), /42 parsers/)',
          ]),
          '--subject',
          'note.md',
        ],
        r.context(r.lane),
      ),
    );
    assert.equal(verified.code, 0, verified.out + verified.err);
    const witness = lastJson(verified.out);
    assert.equal(witness.receipt.cwd, r.lane);
    assert.equal(witness.receipt.subjects[0].checkout, r.lane);
    const finished = await submit(work, { verification: witness, passed: true }, [{ ref: 'note.md' }]);
    assert.equal(finished.run.state, 'succeeded', JSON.stringify(finished.validation));

    // The main checkout checks the run as delivery settlement does.
    const there = r.session(r.main, 'ses_main');
    assert.equal(there.lane, null);
    const fromMain = checkoutResolver(there.store, there);
    assert.equal(fromMain('notes/lane-only.md'), null, 'a bare path from the main checkout names only the main checkout');
    assert.equal(textDigest(fromMain('docs/shared.md')?.text), textDigest(SHARED_MAIN));
    assert.deepEqual(
      runExecutionProblems(there.store, runId, fromMain),
      [],
      'the worktree’s bytes satisfy their receipts from the main checkout',
    );
    assert.deepEqual(staleReceiptSubjects(receipt, fromMain), []);
    assert.equal(
      currentReceipt(shared, fromMain).digest,
      shared.digest,
      'the receipt is answered by its own bytes, not the main checkout’s',
    );

    // The same receipt is never satisfied by different bytes, from any checkout.
    writeFileSync(join(r.lane, 'docs', 'shared.md'), 'Rewritten after the step: 11 lanes.\n');
    // A resolver reads each file once, so each check after the rewrite builds its own, as every surface does per call.
    for (const resolve of [checkoutResolver(there.store, there), checkoutResolver(here.store, here)]) {
      assert.notEqual(currentReceipt(shared, resolve).digest, shared.digest);
      assert.deepEqual(staleReceiptSubjects(receipt, resolve), ['docs/shared.md']);
    }

    // A receipt that names a directory outside the project is never consulted, even holding the same bytes.
    const outside = join(realpathSync(r.fx.root), 'elsewhere');
    mkdirSync(join(outside, 'notes'), { recursive: true });
    writeFileSync(join(outside, 'notes', 'lane-only.md'), LANE_ONLY);
    assert.equal(fromMain('notes/lane-only.md', undefined, { digest: textDigest(LANE_ONLY)!, checkout: outside }), null);
    assert.equal(fromMain('notes/lane-only.md', undefined, { digest: textDigest(LANE_ONLY)!, checkout: r.lane })?.checkout, r.lane);
  } finally {
    r.cleanup();
  }
});
