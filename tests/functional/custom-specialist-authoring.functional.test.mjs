/**
 * tests/functional/custom-specialist-authoring.functional.test.mjs
 *
 * construct-rf26.13: users can author their own specialists/teams without
 * touching specialists/org/ (the built-in roster). Drives the real CLI
 * (`construct team create`, `construct specialist create --custom`) against
 * an isolated tmpdir project + tmpdir HOME, then proves the scaffolded
 * records are resolvable through the same loader path orchestration uses
 * (lib/registry/loader.mjs) — builtin -> user (~/.construct/org) -> project
 * (.cx/org) precedence, matching ADR-0052's model.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { assertPathUnderRoot } from '../helpers/isolation-contract.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(REPO, 'bin', 'construct');

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-custom-org-project-'));
  fs.mkdirSync(path.join(dir, 'specialists'), { recursive: true });
  fs.cpSync(path.join(REPO, 'specialists', 'org'), path.join(dir, 'specialists', 'org'), { recursive: true });
  return dir;
}

function run(args, env) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env,
      ...env,
      CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
      BOOTSTRAP_CHECKED: '1',
    },
  });
}

test('custom specialist/team authoring: scaffold, validate, resolve (project scope)', async (t) => {
  const projectDir = makeProject();
  t.after(() => fs.rmSync(projectDir, { recursive: true, force: true }));

  const teamResult = run([
    'team', 'create', 'widget-team',
    '--owner=widget-specialist',
    '--charter=Owns the Widget product surface end to end, from intake to release.',
    `--root=${projectDir}`,
  ]);
  assert.equal(teamResult.status, 0, teamResult.stderr || teamResult.stdout);

  const teamFile = path.join(projectDir, '.cx', 'org', 'teams', 'widget-team.json');
  assert.ok(fs.existsSync(teamFile), 'team scaffold must write .cx/org/teams/widget-team.json');
  const teamRecord = JSON.parse(fs.readFileSync(teamFile, 'utf8'));
  assert.equal(teamRecord.owner, 'widget-specialist');
  assert.ok(teamRecord.roles.includes('widget-specialist'));

  const specResult = run([
    'specialist', 'create', 'widget-specialist', '--custom',
    '--role=widget-specialist',
    '--team=widget-team',
    '--description=Builds and reviews the Widget subsystem end to end.',
    '--skills=frontend-design/accessibility',
    '--fence-paths=docs/widgets/**',
    `--root=${projectDir}`,
  ]);
  assert.equal(specResult.status, 0, specResult.stderr || specResult.stdout);

  const specFile = path.join(projectDir, '.cx', 'org', 'specialists', 'cx-widget-specialist.json');
  assert.ok(fs.existsSync(specFile), 'specialist scaffold must write .cx/org/specialists/cx-widget-specialist.json');
  const specRecord = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  assert.equal(specRecord.role, 'widget-specialist');
  assert.equal(specRecord.team, 'widget-team');
  assert.deepEqual(specRecord.skills, ['frontend-design/accessibility']);
  assert.deepEqual(specRecord.fence.allowedPaths, ['docs/widgets/**']);

  const promptFile = path.join(projectDir, specRecord.promptFile);
  assert.ok(fs.existsSync(promptFile), 'specialist scaffold must also write a prompt stub');
  assertPathUnderRoot(specFile, projectDir, 'custom specialist file');
  assertPathUnderRoot(promptFile, projectDir, 'custom specialist prompt stub');

  // .cx/** is otherwise gitignored (per this repo's own .gitignore); .cx/org/
  // carries a negation so a scaffolded custom specialist/team is genuinely
  // version-controlled, not silently dropped from the project's git history.
  fs.cpSync(path.join(REPO, '.gitignore'), path.join(projectDir, '.gitignore'));
  spawnSync('git', ['init', '-q'], { cwd: projectDir });
  const checkIgnore = spawnSync('git', ['check-ignore', '-q', '--', path.relative(projectDir, teamFile)], {
    cwd: projectDir,
  });
  assert.equal(checkIgnore.status, 1, '.cx/org/teams/widget-team.json must not be gitignored — it is the project-committed tier');
  const checkIgnoreSpec = spawnSync('git', ['check-ignore', '-q', '--', path.relative(projectDir, specFile)], {
    cwd: projectDir,
  });
  assert.equal(checkIgnoreSpec.status, 1, '.cx/org/specialists/cx-widget-specialist.json must not be gitignored — it is the project-committed tier');

  const { loadRegistry, getSpecialist, getTeam, clearCache } = await import('../../lib/registry/loader.mjs');
  const { validate } = await import('../../lib/registry/validator.mjs');
  clearCache();
  const registry = loadRegistry({ rootDir: projectDir });

  const resolvedTeam = getTeam('widget-team', { rootDir: projectDir });
  assert.ok(resolvedTeam, 'custom team must resolve through getTeam the same way a built-in team does');
  const resolvedSpec = getSpecialist('widget-specialist', { rootDir: projectDir });
  assert.ok(resolvedSpec, 'custom specialist must resolve through getSpecialist the same way a built-in specialist does');
  assert.equal(resolvedSpec.role, 'widget-specialist');

  const builtinSpec = getSpecialist('engineer', { rootDir: projectDir });
  assert.ok(builtinSpec, 'built-in specialists must still resolve alongside the custom one');

  const result = validate(registry);
  assert.equal(result.ok, true, `merged registry (builtin + custom project) must validate:\n${JSON.stringify(result.errors, null, 2)}`);
});

test('custom specialist/team authoring: user (home) scope, isolated from real HOME', async (t) => {
  const projectDir = makeProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-custom-org-home-'));
  t.after(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  const env = { HOME: homeDir, CX_HOME_OVERRIDE: homeDir };

  const teamResult = run([
    'team', 'create', 'gadget-team',
    '--owner=gadget-specialist',
    '--charter=Owns the Gadget product surface across every project on this machine.',
    '--user',
    `--root=${projectDir}`,
  ], env);
  assert.equal(teamResult.status, 0, teamResult.stderr || teamResult.stdout);

  const specResult = run([
    'specialist', 'create', 'gadget-specialist', '--custom',
    '--role=gadget-specialist',
    '--team=gadget-team',
    '--description=Builds and reviews the Gadget subsystem across every project.',
    '--skills=frontend-design/accessibility',
    '--fence-paths=docs/gadgets/**',
    '--user',
    `--root=${projectDir}`,
  ], env);
  assert.equal(specResult.status, 0, specResult.stderr || specResult.stdout);

  const homeTeamFile = path.join(homeDir, '.construct', 'org', 'teams', 'gadget-team.json');
  const homeSpecFile = path.join(homeDir, '.construct', 'org', 'specialists', 'cx-gadget-specialist.json');
  assert.ok(fs.existsSync(homeTeamFile), 'user-scope team must land under ~/.construct/org/teams');
  assert.ok(fs.existsSync(homeSpecFile), 'user-scope specialist must land under ~/.construct/org/specialists');
  assertPathUnderRoot(homeTeamFile, homeDir, 'user-scope team file');
  assertPathUnderRoot(homeSpecFile, homeDir, 'user-scope specialist file');

  const priorOverride = process.env.CX_HOME_OVERRIDE;
  process.env.CX_HOME_OVERRIDE = homeDir;
  try {
    const { loadRegistry, getSpecialist, getTeam, clearCache } = await import('../../lib/registry/loader.mjs');
    clearCache();
    loadRegistry({ rootDir: projectDir });
    assert.ok(getTeam('gadget-team', { rootDir: projectDir }), 'home-scope custom team must resolve without a daemon restart, the same clearCache+loadRegistry path `construct sync` already uses');
    assert.ok(getSpecialist('gadget-specialist', { rootDir: projectDir }), 'home-scope custom specialist must resolve the same way');
  } finally {
    if (priorOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
    else process.env.CX_HOME_OVERRIDE = priorOverride;
    const { clearCache } = await import('../../lib/registry/loader.mjs');
    clearCache();
  }

  const realHome = os.homedir();
  const realConstructOrgProjects = path.join(realHome, '.construct', 'projects');
  if (fs.existsSync(realConstructOrgProjects)) {
    assert.ok(!fs.existsSync(path.join(realConstructOrgProjects, 'gadget-team.json')), 'test must never write into the real machine ~/.construct/projects/');
  }
});

test('custom specialist authoring rejects missing required fields with actionable errors', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-custom-org-reject-'));
  try {
    const result = run(['specialist', 'create', 'incomplete-one', '--custom', `--root=${projectDir}`]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Missing required/);
    assert.match(result.stderr, /--role/);
    assert.match(result.stderr, /--team/);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('custom specialist authoring rejects an unknown team with an actionable, listing error', () => {
  const projectDir = makeProject();
  try {
    const result = run([
      'specialist', 'create', 'orphan-specialist', '--custom',
      '--role=orphan-specialist',
      '--team=does-not-exist-team',
      '--description=A specialist with no home team, deliberately, for this negative test.',
      '--skills=frontend-design/accessibility',
      '--fence-paths=docs/orphan/**',
      `--root=${projectDir}`,
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /does-not-exist-team/);
    assert.match(result.stderr, /construct team create/);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
