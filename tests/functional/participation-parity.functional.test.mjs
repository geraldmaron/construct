/**
 * tests/functional/participation-parity.functional.test.mjs — CLI/MCP/UI
 * parity for participation rules (construct-pteo2.16).
 *
 * The acceptance contract: any rule creatable via the Org Studio UI is
 * creatable and inspectable via `construct participation` (real binary) and
 * the `participation_rules` MCP tool (real module) with identical writes and
 * identical validation errors — because all three are thin envelopes over
 * lib/registry/org-api.mjs. Each surface gets its own tmpdir fixture seeded
 * with the real builtin org so the three writes can be compared byte-for-byte
 * without cross-contamination; CONSTRUCT_HOME_OVERRIDE isolates the user tier and
 * the spawned CLI runs with the fixture as cwd so no state leaks into the
 * repo (config-write cwd leak lesson).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startOrgStudio } from '../../lib/org-studio/server.mjs';
import { participationRules } from '../../lib/mcp/tools/participation.tool.mjs';
import { customOrgDir } from '../../lib/registry/custom-scaffold.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BIN = path.join(REPO, 'bin', 'construct');

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'part-parity-home-'));
const originalHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;

function makeFixture(tag) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `part-parity-${tag}-`));
  fs.cpSync(path.join(REPO, 'specialists', 'org'), path.join(tmp, 'specialists', 'org'), { recursive: true });
  fs.mkdirSync(path.join(tmp, '.cx'), { recursive: true });
  return tmp;
}

const fixtures = { cli: makeFixture('cli'), mcp: makeFixture('mcp'), ui: makeFixture('ui') };
let studio;

before(async () => {
  studio = await startOrgStudio({ rootDir: fixtures.ui, port: 0 });
});
after(async () => {
  await studio?.close();
  if (originalHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = originalHomeOverride;
  for (const dir of [...Object.values(fixtures), homeOverride]) fs.rmSync(dir, { recursive: true, force: true });
});

function cli(fixture, args, { expectFailure = false } = {}) {
  try {
    return execFileSync(process.execPath, [BIN, 'participation', ...args], {
      cwd: fixture,
      encoding: 'utf8',
      env: { ...process.env, CONSTRUCT_HOME_OVERRIDE: homeOverride, HOME: homeOverride, NODE_ENV: 'test' },
    });
  } catch (err) {
    if (!expectFailure) throw err;
    return err.stdout;
  }
}

const ui = (method, url, body) => fetch(studio.url + url, {
  method,
  headers: body ? { 'content-type': 'application/json' } : {},
  body: body ? JSON.stringify(body) : undefined,
}).then((r) => r.json());

const VALID_RULE = {
  id: 'parity-visual-review',
  when: { signalExpr: 'visualDeliverable' },
  recruit: { specialists: ['designer'] },
  role: 'reviewer',
  gate: 'advisory',
  reason: 'visual deliverable — design review',
};

const INVALID_RULE = { id: 'Bad Id', when: {}, recruit: {}, role: 'boss', gate: 'maybe' };

const DROP_IN_REL = path.join(
  path.relative(fixtures.cli, customOrgDir('project', { rootDir: fixtures.cli })),
  'specialists', 'designer.json',
);

test('the same rule created via CLI, MCP, and UI produces byte-identical project config', async () => {
  cli(fixtures.cli, ['add', 'designer', `--rule=${JSON.stringify(VALID_RULE)}`, '--json']);

  const mcpResult = await participationRules({ action: 'add', owner: 'designer', rule: VALID_RULE }, { cwd: fixtures.mcp });
  assert.equal(mcpResult.ok, true, JSON.stringify(mcpResult.errors));

  const uiResult = await ui('POST', '/api/participation/designer?scope=project', VALID_RULE);
  assert.equal(uiResult.ok, true, JSON.stringify(uiResult.errors));

  const written = Object.entries(fixtures).map(([surface, dir]) => {
    const file = path.join(dir, DROP_IN_REL);
    assert.ok(fs.existsSync(file), `${surface} wrote the project drop-in at ${DROP_IN_REL}`);
    return fs.readFileSync(file, 'utf8');
  });
  assert.equal(written[0], written[1], 'CLI and MCP writes are byte-identical');
  assert.equal(written[1], written[2], 'MCP and UI writes are byte-identical');
});

test('the three surfaces list and show the created rule identically', async () => {
  const cliList = JSON.parse(cli(fixtures.cli, ['list', '--json']));
  const mcpList = await participationRules({ action: 'list' }, { cwd: fixtures.mcp });
  const uiList = await ui('GET', '/api/participation');

  const pick = (list) => list.items
    .filter((it) => it.rule.id === 'parity-visual-review')
    .map(({ owner, ownerKind, scope, rule }) => ({ owner, ownerKind, scope, rule }));
  assert.deepEqual(pick(cliList), pick(mcpList), 'CLI and MCP list rows match (path differs only by fixture dir)');
  assert.deepEqual(pick(mcpList), pick(uiList), 'MCP and UI list rows match');
  assert.equal(pick(cliList).length, 1);

  const cliShow = JSON.parse(cli(fixtures.cli, ['show', 'designer', 'parity-visual-review']));
  const mcpShow = await participationRules({ action: 'show', owner: 'designer', rule_id: 'parity-visual-review' }, { cwd: fixtures.mcp });
  assert.deepEqual(cliShow.rule, mcpShow.rule);
});

test('an invalid rule is refused with identical validation errors on all three surfaces', async () => {
  const cliResult = JSON.parse(cli(fixtures.cli, ['validate', 'designer', `--rule=${JSON.stringify(INVALID_RULE)}`, '--json'], { expectFailure: true }));
  const mcpResult = await participationRules({ action: 'validate', owner: 'designer', rule: INVALID_RULE }, { cwd: fixtures.mcp });
  const uiResult = await ui('POST', '/api/validate/participation', { ownerId: 'designer', rule: INVALID_RULE });

  assert.equal(cliResult.ok, false);
  assert.deepEqual(cliResult.errors, mcpResult.errors, 'CLI and MCP errors are identical');
  assert.deepEqual(mcpResult.errors, uiResult.errors, 'MCP and UI errors are identical');

  const cliAdd = JSON.parse(cli(fixtures.cli, ['add', 'designer', `--rule=${JSON.stringify(INVALID_RULE)}`, '--json'], { expectFailure: true }));
  assert.equal(cliAdd.ok, false);
  assert.deepEqual(cliAdd.errors, mcpResult.errors, 'the add path refuses with the same errors validate reports');
});

test('preview parity: the same sample request recruits the same set on all three surfaces', async () => {
  const request = 'design the new dashboard mockups and wireframes';
  const cliPrev = JSON.parse(cli(fixtures.cli, ['preview', `--request=${request}`, '--json']));
  const mcpPrev = await participationRules({ action: 'preview', request }, { cwd: fixtures.mcp });
  const uiPrev = await ui('POST', '/api/preview/participation', { request });

  assert.deepEqual(cliPrev, mcpPrev, 'CLI and MCP previews are identical');
  assert.deepEqual(mcpPrev, uiPrev, 'MCP and UI previews are identical');
  assert.ok(cliPrev.recruited.some((p) => p.rule === 'parity-visual-review'), 'the created rule fires in the preview');
});

test('remove parity: CLI and MCP delete the rule the same way', async () => {
  const cliGone = JSON.parse(cli(fixtures.cli, ['remove', 'designer', 'parity-visual-review', '--json']));
  const mcpGone = await participationRules({ action: 'remove', owner: 'designer', rule_id: 'parity-visual-review' }, { cwd: fixtures.mcp });
  assert.equal(cliGone.ok, true);
  assert.equal(mcpGone.ok, true);
  assert.deepEqual(cliGone.rules, mcpGone.rules);

  const cliList = JSON.parse(cli(fixtures.cli, ['list', '--json']));
  assert.equal(cliList.items.some((it) => it.rule.id === 'parity-visual-review'), false);
});
