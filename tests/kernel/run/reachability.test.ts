/**
 * tests/kernel/run/reachability.test.ts — whether the roles can open the
 * ground the run licensed them.
 *
 * The property held here: containment is by path segment, not by prefix. A
 * prefix test would say /work/app contains /work/application, and a check that
 * passes when it should fail is worse than no check — the run it waves through
 * is exactly the one that comes back with every file read failed and every
 * deliverable ungrounded.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  groundReach,
  reachableFrom,
  unreachableGroundMessage,
} from '../../../src/kernel/run/reachability.ts';

test('a dispatch reaches its own directory and everything under it', () => {
  assert.equal(reachableFrom('/work/app', '/work/app'), true);
  assert.equal(reachableFrom('/work/app/docs', '/work/app'), true);
  assert.equal(reachableFrom('/work/app/docs/adr', '/work/app'), true);
  assert.equal(reachableFrom('/work/app/', '/work/app'), true, 'a trailing separator is not a child');
});

test('a dispatch does not reach a sibling that merely shares a prefix', () => {
  assert.equal(reachableFrom('/work/application', '/work/app'), false);
  assert.equal(reachableFrom('/work', '/work/app'), false, 'nor anything above it');
  assert.equal(reachableFrom('/other/repo', '/work/app'), false);
});

test('a dispatch from the filesystem root reaches everything', () => {
  assert.equal(reachableFrom('/work/app', '/'), true);
  assert.equal(reachableFrom('/', '/'), true);
});

test('licensed ground splits into what the dispatch can open and what it cannot', () => {
  const reach = groundReach(['/work/app/docs', '/other/repo', '/work/app'], '/work/app');
  assert.deepEqual(reach.reachable, ['/work/app/docs', '/work/app']);
  assert.deepEqual(reach.unreachable, ['/other/repo']);
});

test('a run with no licensed roots has nothing to reach and nothing to say', () => {
  const reach = groundReach([], '/work/app');
  assert.deepEqual(reach, { reachable: [], unreachable: [] });
  assert.equal(unreachableGroundMessage(reach, '/work/app', '--allow-distant-ground'), null);
});

test('the message names both ways out, and which roots are the problem', () => {
  const reach = groundReach(['/other/repo', '/work/app'], '/work/app');
  const message = unreachableGroundMessage(reach, '/work/app', '--allow-distant-ground');
  assert.ok(message);
  assert.match(message, /1 licensed ground root is outside/);
  assert.match(message, /\/other\/repo/);
  assert.match(message, /dispatching from: \/work\/app/);
  assert.match(message, /1 other root is reachable/);
  assert.match(message, /--dir=\/other\/repo/, 'the fix, pointed at the root that is missing');
  assert.match(message, /--allow-distant-ground/, 'and the override, for a host that reaches wider');
});

test('every root unreachable says so without claiming a reachable one', () => {
  const message = unreachableGroundMessage(
    groundReach(['/a', '/b'], '/work/app'),
    '/work/app',
    '--allow-distant-ground',
  );
  assert.ok(message);
  assert.match(message, /2 licensed ground roots are outside/);
  assert.doesNotMatch(message, /other root/);
});
