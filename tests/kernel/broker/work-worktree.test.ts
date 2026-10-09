/**
 * tests/kernel/broker/work-worktree.test.ts — a claim names the git worktree
 * its agent edits in, and its reservations record that worktree.
 *
 * One session's agents often edit in different worktrees of the project. A
 * claim that names one of them records its root and current branch on its
 * reservations, so the same path claimed from two worktrees is a merge risk
 * each side sees, and a claim naming the worktree another session runs in
 * collides with that session's own claims. A renewal that names none keeps
 * the worktree its claim records. A path that is not one of the project's
 * worktrees is refused with the ones that are, and a claim that names none
 * records exactly what it always did. Everything runs against a
 * real repository with real linked worktrees in a sterile temp directory.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sterile, type SterileFixture } from '../../harness/sterile.ts';
import { TOOLS } from '../../../src/kernel/broker/tools.ts';
import { record, ToolInputError } from '../../../src/kernel/broker/definition.ts';
import { createBrokerContext, type BrokerBinding } from '../../../src/cli/broker-context.ts';
import { createContext, openProject, projectWorktrees, type CliContext } from '../../../src/cli/context.ts';
import { initializeProject } from '../../../src/kernel/project/initialize.ts';
import { registerSession } from '../../../src/kernel/state/sessions.ts';
import { whereHeld, type Overlap, type PathLease } from '../../../src/kernel/work/leases.ts';
import type { BrokerContext } from '../../../src/kernel/broker/context.ts';

const work = TOOLS.find((t) => t.name === 'work')!;
const call = (ctx: BrokerContext, args: Record<string, unknown>): unknown => work.run(ctx, work.validate(record(args)));

interface Claimed {
  readonly id: string;
  readonly claimToken: string;
  readonly claimLane: string | null;
  readonly leases: readonly PathLease[];
  readonly mergeRisks: readonly Overlap[];
}

interface Repo {
  readonly fx: SterileFixture;
  /** Real paths: git records worktrees resolved, and so does the listing. */
  readonly main: string;
  readonly one: string;
  readonly two: string;
  /** A session per checkout, all on one clock and one store; the same id twice is the same session. */
  session(cwd: string, sessionId: string): BrokerContext;
  /** Work admitted by a remembered outcome, ready to claim. */
  item(title: string): string;
  cleanup(): void;
}

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

/** A repository with a Construct project, a worktree nested inside it, and one beside it. */
function repo(): Repo {
  const fx = sterile();
  mkdirSync(join(fx.root, 'home'), { recursive: true });
  const main = join(realpathSync(fx.root), 'repo');
  mkdirSync(join(main, 'src'), { recursive: true });
  const git = (args: string[]): void => {
    const r = spawnSync('git', args, { cwd: main, env: gitEnv(fx), encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stdout}${r.stderr}`);
  };
  git(['init', '-q', '-b', 'main']);
  writeFileSync(join(main, 'README.md'), '# Lanes\n');
  writeFileSync(join(main, 'src', 'parser.ts'), 'export const parse = (s: string): string => s;\n');
  writeFileSync(join(main, '.gitignore'), '.claude/worktrees/\n');
  const init = initializeProject({ root: main, projectId: 'proj-lanes', name: 'lanes', at: '2026-10-08T12:00:00.000Z' });
  init.store.close();
  git(['add', '.']);
  git(['commit', '-q', '-m', 'start']);
  const one = join(main, '.claude', 'worktrees', 'one');
  const two = join(realpathSync(fx.root), 'repo-two');
  git(['worktree', 'add', '-q', '-b', 'feat/one', one]);
  git(['worktree', 'add', '-q', '-b', 'feat/two', two]);

  let t = Date.parse('2026-10-08T12:00:00.000Z');
  let n = 0;
  const clock = (): string => new Date((t += 1000)).toISOString();
  const ids = (prefix: string): string => `${prefix}-${String(++n).padStart(4, '0')}`;
  const opened = new Map<string, BrokerContext>();
  const session = (cwd: string, sessionId: string): BrokerContext => {
    const known = opened.get(sessionId);
    if (known) return known;
    const env: NodeJS.ProcessEnv = { HOME: join(fx.root, 'home'), XDG_CONFIG_HOME: fx.paths.configDir, XDG_STATE_HOME: fx.paths.stateDir, XDG_DATA_HOME: fx.paths.dataDir, XDG_CACHE_HOME: fx.paths.cacheDir, PATH: process.env.PATH };
    const ctx: CliContext = { ...createContext(cwd, env), now: clock, nextId: ids };
    const project = openProject(ctx);
    // As serve does: a session is registered before its agents are recorded.
    registerSession(project.store, { id: sessionId, host: 'claude-code', surface: 'interactive', machine: 'fixture', at: clock(), laneRoot: project.lane?.root, branch: project.lane?.branch ?? undefined });
    const binding: BrokerBinding = { client: 'claude-code', surface: 'interactive', sessionId, executorId: `session:claude-code:${sessionId}`, actor: 'model via claude-code' };
    const broker = createBrokerContext(ctx, project, binding);
    opened.set(sessionId, broker);
    return broker;
  };
  let lead: BrokerContext | null = null;
  let reason: string | null = null;
  const item = (title: string): string => {
    lead ??= session(main, 'ses_lead');
    reason ??= lead.workflow.remember({ kind: 'outcome', text: 'The parser ships', by: lead.actor, channel: 'relay' }).id;
    return (call(lead, { action: 'add', serves: reason, title }) as { id: string }).id;
  };
  return {
    fx, main, one, two, session, item,
    cleanup: () => {
      for (const b of opened.values()) b.store.close();
      fx.cleanup();
    },
  };
}

test('the project’s worktrees are listed from the repository: the main checkout first, then the rest in path order, each with its branch', () => {
  const r = repo();
  try {
    const listed = projectWorktrees(r.main);
    assert.deepEqual(listed.map((w) => [w.checkout, w.branch, w.main]), [
      [r.main, 'main', true],
      [r.two, 'feat/two', false],
      [r.one, 'feat/one', false],
    ]);
    assert.deepEqual(listed.map((w) => w.root), [r.main, r.two, r.one], 'the project sits at the repository root, so each root is its checkout');
  } finally {
    r.cleanup();
  }
});

test('a claim that names a worktree records its root and branch; a claim that names none is unchanged', () => {
  const r = repo();
  try {
    const lead = r.session(r.main, 'ses_lead');
    const named = r.item('lexer');
    const plain = r.item('docs');

    const held = call(lead, { action: 'claim', id: named, agent: 'builder', worktree: r.one, paths: ['src/lexer.ts'] }) as Claimed;
    assert.deepEqual(held.leases.map((l) => [l.path, l.laneRoot, l.branch, l.agent]), [['src/lexer.ts', r.one, 'feat/one', 'builder']]);
    assert.equal(held.claimLane, r.one, 'the claim itself records the worktree too');

    const unnamed = call(lead, { action: 'claim', id: plain, paths: ['docs/'] }) as Claimed;
    assert.deepEqual(unnamed.leases.map((l) => [l.path, l.laneRoot, l.branch]), [['docs/', 'main', null]], 'no worktree: the main checkout, branch unrecorded, as always');
    assert.equal(unnamed.claimLane, null);

    const trailing = call(lead, { action: 'claim', id: named, agent: 'builder', token: held.claimToken, worktree: `${r.one}/`, paths: ['src/lexer.ts'] }) as Claimed;
    assert.deepEqual(trailing.leases.map((l) => l.laneRoot), [r.one], 'a renewal spelled with a trailing slash names the same worktree');

    const mainNamed = call(lead, { action: 'claim', id: r.item('notes'), worktree: r.main, paths: ['NOTES.md'] }) as Claimed;
    assert.deepEqual(mainNamed.leases.map((l) => [l.laneRoot, l.branch]), [['main', 'main']], 'naming the main checkout keeps the main lane and records its branch');
  } finally {
    r.cleanup();
  }
});

test('the same path claimed from two worktrees: both claims succeed and each reports the other as a merge risk', () => {
  const r = repo();
  try {
    const lead = r.session(r.main, 'ses_lead');
    const first = r.item('parser fix');
    const second = r.item('parser rewrite');

    const a = call(lead, { action: 'claim', id: first, agent: 'one', worktree: r.one, paths: ['src/parser.ts'] }) as Claimed;
    assert.deepEqual(a.mergeRisks, []);
    const b = call(lead, { action: 'claim', id: second, agent: 'two', worktree: r.two, paths: ['src/parser.ts'] }) as Claimed;
    assert.deepEqual(b.leases.map((l) => [l.laneRoot, l.branch]), [[r.two, 'feat/two']]);
    assert.deepEqual(b.mergeRisks.map((o) => [o.kind, o.workId, o.laneRoot, o.branch]), [['merge_risk', first, r.one, 'feat/one']]);
    assert.equal(whereHeld(b.mergeRisks[0]!), `in the worktree at ${r.one} on feat/one`);

    const renewed = call(lead, { action: 'claim', id: first, agent: 'one', token: a.claimToken, worktree: r.one, paths: ['src/parser.ts'] }) as Claimed;
    assert.deepEqual(renewed.mergeRisks.map((o) => [o.kind, o.workId, o.laneRoot, o.branch]), [['merge_risk', second, r.two, 'feat/two']], 'the first claim, renewed, sees the second');
    assert.equal(whereHeld(renewed.mergeRisks[0]!), `in the worktree at ${r.two} on feat/two`);

    const checked = call(lead, { action: 'check', id: first, worktree: r.one, paths: ['src/parser.ts'] }) as { clear: boolean; collisions: Overlap[]; mergeRisks: Overlap[] };
    assert.equal(checked.clear, true, 'a merge risk does not block');
    assert.deepEqual(checked.mergeRisks.map((o) => o.workId), [second]);

    const fromMain = call(lead, { action: 'check', paths: ['src/parser.ts'] }) as { clear: boolean; mergeRisks: Overlap[] };
    assert.equal(fromMain.clear, true, 'from the main checkout both are in other worktrees');
    assert.deepEqual(fromMain.mergeRisks.map((o) => o.laneRoot).sort(), [r.one, r.two].sort());
  } finally {
    r.cleanup();
  }
});

test('a renewal that names no worktree keeps the one its claim records; naming another moves it', () => {
  const r = repo();
  try {
    const lead = r.session(r.main, 'ses_lead');
    const id = r.item('lexer');
    const held = call(lead, { action: 'claim', id, agent: 'builder', worktree: r.one, paths: ['src/lexer.ts'] }) as Claimed;

    const quiet = call(lead, { action: 'claim', id, agent: 'builder', token: held.claimToken }) as Claimed;
    assert.equal(quiet.claimLane, r.one, 'a bare renewal keeps the claim in its worktree');
    const again = call(lead, { action: 'claim', id, agent: 'builder', token: held.claimToken, paths: ['src/lexer.ts', 'src/token.ts'] }) as Claimed;
    assert.deepEqual(again.leases.map((l) => [l.path, l.laneRoot, l.branch]), [['src/lexer.ts', r.one, 'feat/one'], ['src/token.ts', r.one, 'feat/one']], 'renewed paths stay in that worktree');
    assert.equal(again.claimLane, r.one);

    const moved = call(lead, { action: 'claim', id, agent: 'builder', token: held.claimToken, worktree: r.main, paths: ['src/lexer.ts'] }) as Claimed;
    assert.deepEqual(moved.leases.map((l) => [l.laneRoot, l.branch]), [['main', 'main']], 'naming the main checkout moves it there');
    assert.equal(moved.claimLane, null);

    const inOne = r.session(r.one, 'ses_in_one');
    const mainFromOne = call(inOne, { action: 'claim', id: r.item('notes'), worktree: r.main, paths: ['NOTES.md'] }) as Claimed;
    const kept = call(inOne, { action: 'claim', id: mainFromOne.id, token: mainFromOne.claimToken, paths: ['NOTES.md'] }) as Claimed;
    assert.deepEqual(kept.leases.map((l) => [l.laneRoot, l.branch]), [['main', 'main']], 'a claim a worktree session placed in the main checkout stays there on renewal');
    const own = call(inOne, { action: 'claim', id: r.item('own'), paths: ['src/own.ts'] }) as Claimed;
    const renewedOwn = call(inOne, { action: 'claim', id: own.id, token: own.claimToken, paths: ['src/own.ts'] }) as Claimed;
    assert.deepEqual(renewedOwn.leases.map((l) => [l.laneRoot, l.branch]), [[r.one, 'feat/one']], 'a claim in the session’s own checkout renews as it always did');
  } finally {
    r.cleanup();
  }
});

test('a claim naming the worktree another session runs in collides with that session’s claims', () => {
  const r = repo();
  try {
    const lead = r.session(r.main, 'ses_lead');
    const inOne = r.session(r.one, 'ses_in_one');
    assert.equal(inOne.lane?.root, r.one, 'that session is bound to the worktree');
    const theirs = r.item('lexer');
    const ours = r.item('lexer tests');

    call(inOne, { action: 'claim', id: theirs, paths: ['src/lexer.ts'] });
    assert.throws(
      () => call(lead, { action: 'claim', id: ours, agent: 'builder', worktree: r.one, paths: ['src/lexer.ts'] }),
      /reserved by other work: src\/lexer\.ts \(src\/lexer\.ts, held by ses_in_one\/main/,
      'one worktree, one writer per path, whichever session names it',
    );
    const elsewhere = call(lead, { action: 'claim', id: ours, agent: 'builder', worktree: r.two, paths: ['src/lexer.ts'] }) as Claimed;
    assert.deepEqual(elsewhere.mergeRisks.map((o) => [o.laneRoot, o.branch]), [[r.one, 'feat/one']], 'from another worktree it is a merge risk');
  } finally {
    r.cleanup();
  }
});

test('a path that is not a worktree of this project is refused with the ones that are, before anything is written', () => {
  const r = repo();
  try {
    const lead = r.session(r.main, 'ses_lead');
    const id = r.item('lexer');
    const outside = join(r.fx.root, 'elsewhere');
    mkdirSync(outside);
    for (const named of [outside, join(r.one, 'src'), join(r.fx.root, 'missing')]) {
      assert.throws(
        () => call(lead, { action: 'claim', id, worktree: named, paths: ['src/lexer.ts'] }),
        (e: unknown) => {
          assert.ok(e instanceof ToolInputError, String(e));
          assert.equal(e.field, 'worktree');
          assert.deepEqual(e.allowed, [r.main, r.two, r.one]);
          assert.match(e.message, /is not a git worktree of this project; name one of: /);
          assert.ok(e.message.includes(`${r.one} (a worktree, on feat/one)`), e.message);
          assert.ok(e.message.includes(`${r.main} (the main checkout, on main)`), e.message);
          return true;
        },
      );
    }
    assert.equal((call(lead, { action: 'show', id }) as { status: string; leases: unknown[] }).status, 'open', 'the refused claim left the item open');
    assert.throws(() => call(lead, { action: 'check', worktree: outside, paths: ['src/lexer.ts'] }), ToolInputError, 'check is held to the same list');
    assert.throws(() => work.validate(record({ action: 'claim', id, worktree: '.claude/worktrees/one' })), ToolInputError, 'a relative path names nothing');
    assert.throws(() => work.validate(record({ action: 'claim', id, worktree: `${r.one}\u0007` })), ToolInputError);

    rmSync(r.two, { recursive: true, force: true });
    assert.deepEqual(projectWorktrees(r.main).map((w) => w.checkout), [r.main, r.one], 'a worktree whose directory is gone is no longer one to name');
    assert.throws(() => call(lead, { action: 'claim', id, worktree: r.two, paths: ['src/lexer.ts'] }), ToolInputError);
  } finally {
    r.cleanup();
  }
});

test('an accepted handoff and a takeover move reservations to the worktree the new holder names', () => {
  const r = repo();
  try {
    const lead = r.session(r.main, 'ses_lead');
    const id = r.item('parser');
    const held = call(lead, { action: 'claim', id, agent: 'first', worktree: r.one, paths: ['src/parser.ts'] }) as Claimed;
    call(lead, { action: 'handoff', id, agent: 'first', token: held.claimToken, packet: { state: 'half done', next: 'finish the parser' } });
    const accepted = call(lead, { action: 'accept', id, agent: 'second', worktree: r.two }) as Claimed;
    assert.deepEqual(accepted.leases.map((l) => [l.laneRoot, l.branch, l.agent]), [[r.two, 'feat/two', 'second']]);

    const other = r.item('lexer');
    call(lead, { action: 'claim', id: other, agent: 'third', paths: ['src/lexer.ts'] });
    const back = call(lead, { action: 'takeover', id: other, agent: 'main', worktree: r.one, reason: 'the lead finishes it in worktree one' }) as Claimed;
    assert.deepEqual(back.leases.map((l) => [l.laneRoot, l.branch]), [[r.one, 'feat/one']]);
  } finally {
    r.cleanup();
  }
});
