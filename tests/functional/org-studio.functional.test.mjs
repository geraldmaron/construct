/**
 * tests/functional/org-studio.functional.test.mjs — the Org Studio web surface (construct-d1r7.14).
 *
 * Drives the real server over HTTP against a tmp root seeded with the builtin org (so registry-backed
 * validation and route preview resolve), while every write lands in the tmp project tier — never the
 * repo. Asserts the acceptance contract: a specialist, team, and relationship (contract) can be
 * created visually; inline validation is the same org-api schema the CLI enforces; saves write valid
 * config readable back through the API; import/export round-trips the topology; and a cross-origin
 * write is refused so a stray browser tab cannot drive local org edits.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startOrgStudio } from '../../lib/org-studio/server.mjs';
import { customOrgDir } from '../../lib/registry/custom-scaffold.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let studio;
let rootDir;

before(async () => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'org-studio-'));
  fs.cpSync(path.join(REPO, 'specialists/org'), path.join(rootDir, 'specialists/org'), { recursive: true });
  studio = await startOrgStudio({ rootDir, port: 0 });
});
after(async () => {
  await studio?.close();
  if (rootDir) fs.rmSync(rootDir, { recursive: true, force: true });
});

const j = (method, url, body) => fetch(studio.url + url, {
  method,
  headers: body ? { 'content-type': 'application/json' } : {},
  body: body ? JSON.stringify(body) : undefined,
}).then((r) => r.json());

const validSpecialist = {
  name: 'widget-writer', role: 'widget-writer', description: 'Authors widget documentation and keeps the widget catalog current.',
  modelTier: 'standard', team: 'widget-team', skills: ['frontend-design/accessibility'], whenToUse: 'when documenting widgets',
  handoffCandidates: [], fence: { allowedPaths: ['docs/widgets/**'] },
};
const validTeam = {
  id: 'widget-team', name: 'Widget Team', owner: 'widget-writer',
  charter: 'Owns the widget catalog, its documentation, and the widget review process end to end.',
  roles: ['widget-writer'], decisionRights: ['widget-scope'], forbiddenDecisions: [],
};

test('serves the self-contained SPA at the root', async () => {
  const res = await fetch(studio.url + '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();
  assert.match(html, /Construct Org Studio/);
  assert.match(html, /\/api\/org/, 'the SPA talks to the JSON API');
});

test('aggregate endpoint returns every org kind from the seeded builtins', async () => {
  const { org } = await j('GET', '/api/org');
  assert.deepEqual(Object.keys(org).sort(), ['contract', 'fence', 'skill', 'specialist', 'team']);
  assert.ok(org.specialist.count >= 12);
  assert.ok(org.contract.count >= 1);
});

test('inline validation is the same schema the CLI enforces', async () => {
  const bad = await j('POST', '/api/validate/specialist', { name: 'x', description: 'too short' });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /description/.test(e.message)), 'short description is rejected');

  const existing = await j('GET', '/api/entities/specialist/cx-architect');
  const good = await j('POST', '/api/validate/specialist', existing.record);
  assert.equal(good.ok, true, JSON.stringify(good.errors));
});

test('a team, specialist, and relationship can be created visually and read back', async () => {
  const team = await j('POST', '/api/entities/team?scope=project', validTeam);
  assert.equal(team.ok, true, JSON.stringify(team.errors));

  const specialist = await j('POST', '/api/entities/specialist?scope=project', validSpecialist);
  assert.equal(specialist.ok, true, JSON.stringify(specialist.errors));

  const rel = await j('POST', '/api/entities/contract?scope=project', {
    id: 'widget-to-qa', producer: 'cx-widget-writer', consumer: 'user',
    trigger: { riskFlags: ['ui'] }, input: { shape: 'widget-doc' }, output: { type: 'review' },
  });
  assert.equal(rel.ok, true, JSON.stringify(rel.errors));

  const back = await j('GET', '/api/entities/specialist/cx-widget-writer');
  assert.equal(back.record.modelTier, 'standard');
  assert.deepEqual(back.record.fence.allowedPaths, ['docs/widgets/**'], 'the fence path round-trips');

  const onDisk = path.join(customOrgDir('project', { rootDir }), 'specialists', 'cx-widget-writer.json');
  assert.ok(fs.existsSync(onDisk), 'the save wrote a project-scope file');
});

test('an update through the API persists a changed field', async () => {
  const updated = await j('PUT', '/api/entities/specialist/cx-widget-writer?scope=project', { ...validSpecialist, modelTier: 'reasoning' });
  assert.equal(updated.ok, true, JSON.stringify(updated.errors));
  const back = await j('GET', '/api/entities/specialist/cx-widget-writer');
  assert.equal(back.record.modelTier, 'reasoning');
});

test('export then import round-trips the project topology', async () => {
  const exported = await j('GET', '/api/export?scope=project');
  assert.ok(exported.specialists['cx-widget-writer'], 'export carries the created specialist');
  assert.ok(exported.teams['widget-team'], 'export carries the created team');
  const dry = await j('POST', '/api/import?scope=project&dryRun=true', exported);
  assert.equal(dry.ok, true, JSON.stringify(dry.errors));
});

test('route preview surfaces which specialists a description would overlap', async () => {
  const preview = await j('POST', '/api/preview/route', { draftSpecialist: { description: 'design accessible interfaces', skills: ['frontend-design/accessibility'] } });
  assert.ok(Array.isArray(preview.candidates));
  assert.ok(preview.candidates.length >= 1, 'a design description overlaps at least one builtin specialist');
});

test('a cross-origin write is refused; a same-origin write is allowed', async () => {
  const blocked = await fetch(studio.url + '/api/entities/specialist?scope=project', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example' }, body: '{}',
  });
  assert.equal(blocked.status, 403);

  const allowed = await fetch(studio.url + '/api/entities/team?scope=project', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: studio.url }, body: JSON.stringify(validTeam),
  });
  assert.notEqual(allowed.status, 403, 'a same-origin request is not refused');
});
