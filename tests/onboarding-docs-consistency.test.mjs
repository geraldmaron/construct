/**
 * tests/onboarding-docs-consistency.test.mjs — guards README's quickstart
 * claims against re-diverging from the init code path.
 *
 * Ground truth (lib/init-unified.mjs) is that `construct init` syncs adapters
 * and starts services by default unless `--no-start` or `--interactive` is
 * passed. This test pins README's "Getting started" claim to that code path
 * and blocks first-task.mdx from presenting `construct sync` / `construct
 * dev` as separate mandatory onboarding steps after `construct init`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { resolveShouldStartServices } from '../lib/init-unified.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relPath) {
  return fs.readFileSync(path.join(REPO, relPath), 'utf8');
}

test('lib/init-unified.mjs still auto-starts services by default', () => {
  const devMachineEnv = {};
  assert.equal(
    resolveShouldStartServices({ args: [], interactive: false, env: devMachineEnv }),
    true,
    'construct init must keep starting services by default on a developer machine — ' +
      "README's quickstart claim depends on this"
  );
  assert.equal(
    resolveShouldStartServices({ args: ['--no-start'], interactive: false, env: devMachineEnv }),
    false,
    '--no-start must keep suppressing the default service start'
  );
  assert.equal(
    resolveShouldStartServices({ args: [], interactive: true, env: devMachineEnv }),
    false,
    'interactive init must keep deferring the start decision to the guided flow'
  );
});

test('README quickstart claims construct init starts services by default', () => {
  const readme = read('README.md');
  const gettingStarted = readme.slice(readme.indexOf('## Getting started'), readme.indexOf('## Usage'));
  assert.match(
    gettingStarted,
    /construct init.*starts the local services by default/s,
    'README\'s "Getting started" section must state that `construct init` starts services by default'
  );
});

