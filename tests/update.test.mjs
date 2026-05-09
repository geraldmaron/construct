/**
 * tests/update.test.mjs — regression tests for the source-checkout update flow.
 *
 * Verifies that construct update only runs from a valid Construct checkout and
 * that it executes install, sync, and doctor in the expected order.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildUpdatePlan, findConstructSourceRoot, runUpdate } from '../lib/update.mjs';

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(root, relativePath, content) {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function makeConstructCheckout() {
  const root = tempDir('construct-update-');
  writeFile(root, 'package.json', `${JSON.stringify({
    name: '@geraldmaron/construct',
    version: '9.9.9',
    bin: { construct: 'bin/construct' },
  }, null, 2)}\n`);
  writeFile(root, 'bin/construct', '#!/usr/bin/env node\n');
  writeFile(root, 'sync-agents.mjs', 'export {};\n');
  writeFile(root, 'lib/cli-commands.mjs', 'export const CLI_COMMANDS = [];\n');
  return root;
}

test('findConstructSourceRoot climbs parents to locate the checkout root', () => {
  const root = makeConstructCheckout();
  const nestedDir = path.join(root, 'agents', 'prompts');
  fs.mkdirSync(nestedDir, { recursive: true });

  assert.equal(findConstructSourceRoot(nestedDir), root);
});

test('buildUpdatePlan rejects directories outside a Construct checkout', () => {
  const outsideDir = tempDir('construct-update-outside-');

  assert.throws(
    () => buildUpdatePlan({ cwd: outsideDir }),
    /must be run from inside a Construct source checkout/,
  );
});

test('runUpdate installs globally, then runs sync and doctor from the checkout', () => {
  const root = makeConstructCheckout();
  const calls = [];
  const stdout = { write(message) { calls.push(['stdout', message]); } };
  const fakeSpawn = (command, args, options) => {
    calls.push([command, args, options.cwd, options.stdio]);
    return { status: 0 };
  };

  const plan = runUpdate({ cwd: root, env: { PATH: process.env.PATH }, spawn: fakeSpawn, stdout });

  assert.equal(plan.sourceRoot, root);
  assert.equal(plan.version, '9.9.9');
  assert.deepEqual(calls.filter((entry) => entry[0] !== 'stdout'), [
    ['npm', ['install', '-g', '.'], root, 'inherit'],
    [process.execPath, [path.join(root, 'bin', 'construct'), 'sync', '--no-docs'], root, 'inherit'],
    [process.execPath, [path.join(root, 'bin', 'construct'), 'doctor'], root, 'inherit'],
  ]);
});

test('runUpdate stops after the first failing step', () => {
  const root = makeConstructCheckout();
  const calls = [];
  const fakeSpawn = (command, args, options) => {
    calls.push([command, args, options.cwd]);
    if (args.includes('sync')) return { status: 2 };
    return { status: 0 };
  };

  assert.throws(
    () => runUpdate({ cwd: root, env: { PATH: process.env.PATH }, spawn: fakeSpawn, stdout: { write() {} } }),
    /Regenerate host adapters failed with exit code 2/,
  );
  assert.deepEqual(calls, [
    ['npm', ['install', '-g', '.'], root],
    [process.execPath, [path.join(root, 'bin', 'construct'), 'sync', '--no-docs'], root],
  ]);
});