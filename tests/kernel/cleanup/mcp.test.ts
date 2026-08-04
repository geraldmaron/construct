/**
 * tests/kernel/cleanup/mcp.test.ts — which MCP registrations belong to the
 * predecessor (construct-mei).
 *
 * The defect: detection was a hardcoded id list, `['memory', 'cass']`, while v2
 * registers its orchestration server as `construct-mcp`. Cleanup therefore
 * walked straight past the strongest surface the predecessor has — a connected,
 * tool-serving MCP endpoint — and reported the machine clean.
 *
 * That is not dormant clutter. OpenCode cannot isolate MCP servers
 * (construct-nv0: both of its config seams merge with the operator's own
 * registrations), so a v3 role dispatched there sees v2's tools too. It was
 * observed: a probe model told to call `submit_draft` called
 * `construct-mcp_find_tool` instead and got back v2's workspace-preset tools.
 *
 * So detection matches on the command an entry RUNS rather than on what it is
 * called. The signature is the predecessor's `lib/mcp/server.mjs`, a fact about
 * its package layout — which also keeps it from matching the successor, now
 * that the two share a package name: v3 ships `bin/` and `dist/` and has no
 * `lib/` at all.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildCleanupCatalog } from '../../../src/kernel/cleanup/catalog.ts';
import type { CleanupItem, SpawnFn } from '../../../src/kernel/cleanup/catalog.ts';
import { resolvePaths } from '../../../src/kernel/paths.ts';

const NOT_FOUND_SPAWN: SpawnFn = () => ({ status: 1, stdout: '', stderr: '' });

/** v2's registration, exactly as it appears in this machine's opencode.json. */
const V2_SERVER = {
  type: 'local',
  command: ['node', '/opt/homebrew/lib/node_modules/@geraldmaron/construct/lib/mcp/server.mjs'],
  environment: { CONSTRUCT_TRACE_BACKEND: '{env:CONSTRUCT_TRACE_BACKEND}' },
};

function fixtureHome(opencode: unknown): { home: string; file: string; cleanup: () => void } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-mcp-'));
  const dir = path.join(home, '.config', 'opencode');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'opencode.json');
  fs.writeFileSync(file, `${JSON.stringify(opencode, null, 2)}\n`);
  return { home, file, cleanup: () => fs.rmSync(home, { recursive: true, force: true }) };
}

function mcpItem(home: string): CleanupItem {
  const items = buildCleanupCatalog({
    cwd: path.join(home, 'project'),
    home,
    paths: resolvePaths({ HOME: home }, home),
    spawn: NOT_FOUND_SPAWN,
  });
  const item = items.find((i: CleanupItem) => i.id === 'machine-memory-mcp');
  assert.ok(item, 'the MCP registration item should exist');
  return item;
}

test('the predecessor is found by what it runs, not by what it is named', () => {
  // `construct-mcp` is in no id list anywhere. The path is what identifies it.
  const f = fixtureHome({ mcp: { 'construct-mcp': V2_SERVER } });
  try {
    const item = mcpItem(f.home);
    assert.equal(item.detect(), true, 'this is exactly what cleanup used to miss');
    assert.match(item.remove(), /opencode/);

    const after = JSON.parse(fs.readFileSync(f.file, 'utf8'));
    assert.equal('mcp' in after, false, 'the container empties and goes with it');
  } finally {
    f.cleanup();
  }
});

test('a name nobody wrote down is still caught', () => {
  // The whole point of matching on the command: the id can be anything.
  const f = fixtureHome({ mcp: { 'something-else-entirely': V2_SERVER } });
  try {
    assert.equal(mcpItem(f.home).detect(), true);
  } finally {
    f.cleanup();
  }
});

test("the operator's own servers survive", () => {
  // The shape of this machine's real config: eight unrelated servers beside v2's.
  const others = {
    context7: { type: 'local', command: ['npx', '-y', '@upstash/context7-mcp@3.2.2'] },
    linear: { type: 'local', command: ['npx', '-y', '@linear/mcp-server'] },
    github: { type: 'remote', url: 'https://api.githubcopilot.com/mcp/' },
  };
  const f = fixtureHome({ mcp: { ...others, 'construct-mcp': V2_SERVER }, model: 'anthropic/x' });
  try {
    assert.equal(mcpItem(f.home).detect(), true);
    mcpItem(f.home).remove();

    const after = JSON.parse(fs.readFileSync(f.file, 'utf8'));
    assert.deepEqual(after.mcp, others, 'every unrelated server is left exactly as it was');
    assert.equal(after.model, 'anthropic/x', 'and so is everything outside mcp');
  } finally {
    f.cleanup();
  }
});

test('the successor is not mistaken for the predecessor', () => {
  // v3 now shares the predecessor's package name, so the signature must be the
  // layout rather than the name. v3 has no lib/ — it ships bin/ and dist/.
  const f = fixtureHome({
    mcp: {
      construct: {
        type: 'local',
        command: ['node', '/opt/homebrew/lib/node_modules/@geraldmaron/construct/bin/construct.mjs', 'role-serve'],
      },
    },
  });
  try {
    assert.equal(mcpItem(f.home).detect(), false, 'v3 must survive its own uninstaller');
  } finally {
    f.cleanup();
  }
});

test('a config with no MCP servers at all is not a trace', () => {
  const f = fixtureHome({ model: 'anthropic/x' });
  try {
    assert.equal(mcpItem(f.home).detect(), false);
  } finally {
    f.cleanup();
  }
});

/**
 * ~/.construct — the predecessor's home directory (construct-lqs).
 *
 * It was in no scope at all: the catalog resolved `.construct` only relative to
 * cwd, so a machine carrying 685MB of v2 traces and vector indexes could pass
 * "zero detected traces at machine scope" truthfully. An uninstaller that
 * reports success while leaving its largest artifact behind teaches the operator
 * to trust a number that does not mean what they think.
 */
test("the predecessor's home directory is a machine-scope trace", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-home-'));
  try {
    const project = path.join(home, '.construct', 'projects', 'abc123');
    fs.mkdirSync(path.join(project, 'traces'), { recursive: true });
    fs.writeFileSync(path.join(project, 'traces', '2026-07-23.jsonl'), '{"a":1}\n');
    fs.writeFileSync(path.join(home, '.construct', 'hook-calls.jsonl'), '{"b":2}\n');

    const items = buildCleanupCatalog({
      cwd: path.join(home, 'project'),
      home,
      paths: resolvePaths({ HOME: home }, home),
      spawn: NOT_FOUND_SPAWN,
    });
    const item = items.find((i: CleanupItem) => i.id === 'machine-home-construct');
    assert.ok(item, 'the item must exist, or the exit criterion is vacuous');

    assert.equal(item.scope, 'machine', 'cwd has nothing to do with where this lives');
    assert.equal(
      item.risk,
      'ask',
      'the largest thing cleanup touches is not removed without a question',
    );
    assert.equal(item.detect(), true);
    assert.match(item.describe(), /traces/, 'the prompt says what it is about to take');

    item.remove();
    assert.equal(fs.existsSync(path.join(home, '.construct')), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a home without the predecessor reports nothing to remove', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-home-'));
  try {
    const items = buildCleanupCatalog({
      cwd: path.join(home, 'project'),
      home,
      paths: resolvePaths({ HOME: home }, home),
      spawn: NOT_FOUND_SPAWN,
    });
    const item = items.find((i: CleanupItem) => i.id === 'machine-home-construct');
    assert.equal(item?.detect(), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

/**
 * The successor's own directories (construct-a5q).
 *
 * v3 resolves its directories from the same XDG variables under the same
 * application name, so ~/.local/share/construct is at once "a predecessor
 * trace" and the running Construct's home. Removing it wholesale — which is
 * what this catalog did — takes the store holding every work log entry, task
 * row and raised decision, plus the capability secret. Append-only triggers
 * guard writes, not unlink.
 *
 * These are the post-cutover state: a machine where BOTH exist. v2's traces
 * must still go; v3's must not.
 */
function bothInstalled(): { home: string; paths: ReturnType<typeof resolvePaths>; cleanup: () => void } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-both-'));
  const paths = resolvePaths({ HOME: home }, home);

  // The successor: its store and its capability secret.
  fs.mkdirSync(paths.dataDir, { recursive: true });
  fs.writeFileSync(path.join(paths.dataDir, 'construct.db'), 'SQLite format 3\0');
  fs.writeFileSync(path.join(paths.dataDir, 'capability-secret'), 'secret');

  // The predecessor, in directories it does not share with the successor.
  fs.mkdirSync(paths.stateDir, { recursive: true });
  fs.writeFileSync(path.join(paths.stateDir, 'audit-trail.jsonl'), '{}\n');
  fs.mkdirSync(path.join(home, '.construct', 'projects'), { recursive: true });

  return { home, paths, cleanup: () => fs.rmSync(home, { recursive: true, force: true }) };
}

test("the successor's store and secret survive a full cleanup", () => {
  const f = bothInstalled();
  try {
    const items = buildCleanupCatalog({
      cwd: path.join(f.home, 'project'),
      home: f.home,
      paths: f.paths,
      spawn: NOT_FOUND_SPAWN,
    });

    // Everything, both tiers — the way an operator who wants v2 gone runs it.
    for (const item of items) if (item.detect()) item.remove();

    assert.ok(
      fs.existsSync(path.join(f.paths.dataDir, 'construct.db')),
      'the store must survive — it is the one thing the system promises is append-only',
    );
    assert.ok(
      fs.existsSync(path.join(f.paths.dataDir, 'capability-secret')),
      'and so must the signing key, or every issued token is orphaned',
    );

    // The predecessor still goes. A guard that kept everything would be a
    // different bug wearing the same fix.
    assert.equal(fs.existsSync(path.join(f.home, '.construct')), false, "v2's home is still removed");
    assert.equal(fs.existsSync(f.paths.stateDir), false, "v2's state dir is still removed");
  } finally {
    f.cleanup();
  }
});

test('refusing to remove the successor is said out loud, not skipped quietly', () => {
  const f = bothInstalled();
  try {
    const items = buildCleanupCatalog({
      cwd: path.join(f.home, 'project'),
      home: f.home,
      paths: f.paths,
      spawn: NOT_FOUND_SPAWN,
    });
    const dataItem = items.find((i: CleanupItem) => i.id === 'machine-data');
    assert.ok(dataItem);

    assert.equal(dataItem.detect(), true, 'it is still reported, not hidden');
    assert.match(dataItem.describe(), /KEPT/, 'the plan says it will be kept before anything runs');
    const result = dataItem.remove();
    assert.match(result, /kept/i);
    assert.match(result, /NOT removed/, 'and admits predecessor leftovers may remain inside');
  } finally {
    f.cleanup();
  }
});

test('a machine with no successor still gets a clean sweep', () => {
  // The guard must not turn into a reason to keep v2's directories forever.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-v2only-'));
  try {
    const paths = resolvePaths({ HOME: home }, home);
    fs.mkdirSync(paths.dataDir, { recursive: true });
    fs.writeFileSync(path.join(paths.dataDir, 'completions.zsh'), '# v2\n');

    const items = buildCleanupCatalog({
      cwd: path.join(home, 'project'),
      home,
      paths,
      spawn: NOT_FOUND_SPAWN,
    });
    const dataItem = items.find((i: CleanupItem) => i.id === 'machine-data');
    assert.equal(dataItem?.detect(), true);
    assert.match(dataItem!.remove(), /removed/);
    assert.equal(fs.existsSync(paths.dataDir), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('an item that will be kept does not advertise itself as removable', () => {
  // The dry-run plan marks removable items ✓/◐ under "pass --yes to remove ✓
  // items". A kept item wearing ✓ contradicts its own description, and the mark
  // is what a reader scans (construct-a5q).
  const f = bothInstalled();
  try {
    const items = buildCleanupCatalog({
      cwd: path.join(f.home, 'project'),
      home: f.home,
      paths: f.paths,
      spawn: NOT_FOUND_SPAWN,
    });
    const data = items.find((i: CleanupItem) => i.id === 'machine-data');
    const state = items.find((i: CleanupItem) => i.id === 'machine-state');

    assert.equal(data?.keeps?.(), true, "the successor's data dir is kept");
    assert.equal(state?.keeps?.(), false, "the predecessor's state dir is not");
  } finally {
    f.cleanup();
  }
});
