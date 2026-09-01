/**
 * tests/cli/daemon-spawn-discipline.test.ts — the door is single, and this is
 * what keeps it single.
 *
 * The predecessor's daemon leak did not come from the daemon. It came from an
 * auto-start buried in library code that ran during init, so raising a
 * resident process stopped being something a person did and became something
 * that happened. The protection against that recurring is structural rather
 * than behavioral: exactly one module may reach the loop, exactly one module
 * may spawn the launcher, and no verb, install path, or kernel module can do
 * either. A behavioral test would have to guess which caller might one day
 * spawn it; this reads the whole source tree and names every file that could.
 *
 * The guarantee chosen, stated plainly: the daemon ENTRY (startDaemon) and the
 * launcher path used to spawn it are referenced by src/cli/daemon.ts and by
 * nothing else in src/. src/cli/index.ts may name the verb — that is the
 * dispatch table, and typing the verb is exactly how residency is opt-in — but
 * it may not spawn anything itself.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

/** The one module allowed to reach the loop and to spawn the launcher. */
const OWNER = join('cli', 'daemon.ts');

/** The loop's own home: these modules are the daemon, not callers of it. */
const KERNEL_HOME = join('kernel', 'daemon');

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts')) found.push(full);
  }
  return found;
}

function everySource(): Array<{ readonly rel: string; readonly text: string }> {
  return sourceFiles(SRC).map((path) => ({
    rel: relative(SRC, path),
    text: readFileSync(path, 'utf8'),
  }));
}

test('nothing outside the daemon verb can reach the daemon loop', () => {
  const offenders = everySource()
    .filter((file) => file.rel !== OWNER && !file.rel.startsWith(KERNEL_HOME))
    .filter((file) => /\bstartDaemon\b/.test(file.text) || /kernel\/daemon\//.test(file.text))
    .map((file) => file.rel);
  assert.deepStrictEqual(
    offenders,
    [],
    'only cli/daemon.ts may import the daemon loop — an auto-start from anywhere else is the leak class',
  );
});

test('no module both starts processes and names the daemon', () => {
  // Other modules legitimately name the launcher — writing an MCP entry into a
  // host's config is naming a binary, not running one — and cleanup names the
  // daemon's leftovers in prose, which is a thing it must be able to reap. So
  // the check is the conjunction that actually raises one: a module that can
  // start a process AND carries the verb as a literal argument.
  const offenders = everySource()
    .filter((file) => file.rel !== OWNER)
    .filter((file) => /node:child_process/.test(file.text) && /(['"])daemon\1/.test(file.text))
    .map((file) => file.rel);
  assert.deepStrictEqual(offenders, [], 'the daemon is respawned from exactly one place');
});

test('the verb table dispatches the daemon and spawns nothing', () => {
  const index = readFileSync(join(SRC, 'cli', 'index.ts'), 'utf8');
  assert.match(index, /case 'daemon':/, 'the verb is reachable by typing it');
  assert.doesNotMatch(index, /\bspawn\b/, 'and the dispatcher itself spawns nothing');
  assert.doesNotMatch(index, /child_process/, 'the dispatch table starts no processes');
});

test('init, install, and the kernel raise nothing', () => {
  // The three paths the leak actually came through, named so a future edit to
  // any of them trips this rather than a code review.
  for (const path of [join('cli', 'init.ts'), join('cli', 'skills.ts')]) {
    const text = readFileSync(join(SRC, path), 'utf8');
    assert.doesNotMatch(text, /daemon/i, `${path} says nothing about a resident process`);
  }
  const kernelOffenders = everySource()
    .filter((file) => file.rel.startsWith('kernel') && !file.rel.startsWith(KERNEL_HOME))
    .filter((file) => /startDaemon|daemonSocketPath|bindDaemonSocket/.test(file.text))
    .map((file) => file.rel);
  assert.deepStrictEqual(kernelOffenders, [], 'no kernel module raises or addresses the resident');
});
