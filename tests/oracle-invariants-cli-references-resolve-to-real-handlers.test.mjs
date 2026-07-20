/**
 * tests/oracle-invariants-cli-references-resolve-to-real-handlers.test.mjs — the
 * `cli-references-resolve-to-real-handlers` Layer 1 invariant: SERVICES args
 * extraction, and check() against a real hermetic fixture repo modeling
 * lib/cli-commands.mjs + lib/embed/supervision.mjs + a daemon CLI module.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { id, layer, extractServiceInvocations, check } from '../lib/oracle/invariants/cli-references-resolve-to-real-handlers.mjs';

const FIXTURE_SUPERVISION_SOURCE = `const SERVICES = {
  embed: {
    launchdLabel: 'com.construct.embed',
    args: ['embed', 'start', '--foreground'],
  },
  oracle: {
    launchdLabel: 'com.construct.oracle',
    args: ['oracle', 'start', '--unknown-flag'],
  },
  ghost: {
    launchdLabel: 'com.construct.ghost',
    args: ['ghost', 'start'],
  },
};
`;

function makeFixtureRepo(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-invariant-cli-refs-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.mkdirSync(path.join(cwd, 'lib', 'embed'), { recursive: true });
  fs.mkdirSync(path.join(cwd, 'lib', 'oracle'), { recursive: true });

  fs.writeFileSync(
    path.join(cwd, 'lib', 'cli-commands.mjs'),
    "export const CLI_COMMANDS = [{ name: 'embed' }, { name: 'oracle' }];\n",
  );
  fs.writeFileSync(
    path.join(cwd, 'lib', 'embed', 'cli.mjs'),
    "if (args[i] === '--foreground') { flags.foreground = true; }\n",
  );
  fs.writeFileSync(
    path.join(cwd, 'lib', 'oracle', 'cli.mjs'),
    "const foreground = args.includes('--foreground');\n",
  );
  fs.writeFileSync(path.join(cwd, 'lib', 'embed', 'supervision.mjs'), FIXTURE_SUPERVISION_SOURCE);

  return cwd;
}

test('invariant module exports id/layer per the registry contract', () => {
  assert.equal(id, 'cli-references-resolve-to-real-handlers');
  assert.equal(layer, 1);
});

test('extractServiceInvocations parses each service block\'s args array independently', () => {
  const invocations = extractServiceInvocations(FIXTURE_SUPERVISION_SOURCE);
  assert.deepEqual(invocations, [
    { service: 'embed', tokens: ['embed', 'start', '--foreground'] },
    { service: 'oracle', tokens: ['oracle', 'start', '--unknown-flag'] },
    { service: 'ghost', tokens: ['ghost', 'start'] },
  ]);
});

test('check(): a flag the target CLI module recognizes passes', async (t) => {
  const cwd = makeFixtureRepo(t);
  const result = await check({ cwd });
  const embedFlag = result.results.find((r) => r.service === 'embed' && r.flag === '--foreground');
  assert.equal(embedFlag.status, 'passed');
});

test('check(): a flag absent from the target CLI module\'s source is a violation', async (t) => {
  const cwd = makeFixtureRepo(t);
  const result = await check({ cwd });
  const oracleFlag = result.results.find((r) => r.service === 'oracle' && r.flag === '--unknown-flag');
  assert.equal(oracleFlag.status, 'failed');
  assert.equal(oracleFlag.violation, true);
});

test('check(): a top-level command not registered in CLI_COMMANDS is a violation', async (t) => {
  const cwd = makeFixtureRepo(t);
  const result = await check({ cwd });
  const ghostResult = result.results.find((r) => r.service === 'ghost' && !r.flag);
  assert.equal(ghostResult.status, 'failed');
  assert.match(ghostResult.detail, /not a registered command/);
});

test('check(): a service with no known CLI-module convention gets unknown for its flags, not a false failed', async (t) => {
  const cwd = makeFixtureRepo(t);
  fs.writeFileSync(
    path.join(cwd, 'lib', 'cli-commands.mjs'),
    "export const CLI_COMMANDS = [{ name: 'embed' }, { name: 'oracle' }, { name: 'ghost' }];\n",
  );
  fs.writeFileSync(
    path.join(cwd, 'lib', 'embed', 'supervision.mjs'),
    "const SERVICES = {\n  ghost: {\n    args: ['ghost', 'start', '--some-flag'],\n  },\n};\n",
  );
  const result = await check({ cwd });
  const ghostFlag = result.results.find((r) => r.service === 'ghost' && r.flag === '--some-flag');
  assert.equal(ghostFlag.status, 'unknown');
  assert.equal(result.unresolved.length, 1);
});

test('check(): overall rolls up to failed given the fixture\'s known --unknown-flag and unregistered ghost command', async (t) => {
  const cwd = makeFixtureRepo(t);
  const result = await check({ cwd });
  assert.equal(result.status, 'failed');
});

test('check(): a missing lib/cli-commands.mjs degrades to collection-error, not a crash', async (t) => {
  const cwd = makeFixtureRepo(t);
  fs.rmSync(path.join(cwd, 'lib', 'cli-commands.mjs'));
  const result = await check({ cwd });
  assert.equal(result.status, 'collection-error');
});
