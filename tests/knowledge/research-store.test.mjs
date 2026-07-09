/**
 * tests/knowledge/research-store.test.mjs — A2 research persistence contract.
 *
 * Verifies the round-trip: add a research finding, get a frontmatter-stamped
 * file under .cx/knowledge/external/research/, validate the schema invariants,
 * reject invalid inputs.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import { addResearchFinding } from '../../lib/knowledge/research-store.mjs';

// addResearchFinding calls syncFileStateToSql, which builds a VectorClient
// whose db path falls back to resolveStateDir(process.cwd(), ...) — reading
// the machine-scoped state root (ADR-0066) via CX_HOME_OVERRIDE in-process,
// not via the `cwd` each test passes explicitly. Pin it file-wide or every
// test below writes into the real developer machine's ~/.construct/projects.
const HOME_SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'a2-research-home-'));
const prevHomeOverride = process.env.CX_HOME_OVERRIDE;
process.env.CX_HOME_OVERRIDE = HOME_SANDBOX;
after(() => {
  if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
  fs.rmSync(HOME_SANDBOX, { recursive: true, force: true });
});

test('addResearchFinding writes a frontmatter-stamped markdown file', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'a2-research-'));
  t.after(() => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {} });
  fs.mkdirSync(path.join(cwd, '.cx'), { recursive: true });

  const { path: outPath, bytes } = await addResearchFinding({
    cwd,
    slug: 'oidc-trusted-publishers',
    topic: 'npm OIDC Trusted Publishers requirements',
    confidence: 'confirmed',
    sources: [{ url: 'https://docs.npmjs.com/trusted-publishers' }],
    body: 'FINDINGS\n- npm CLI 11.5.1+ required\n\nRECOMMENDATION\n- use Node 24',
  });

  assert.ok(fs.existsSync(outPath));
  assert.ok(bytes > 0);
  const content = fs.readFileSync(outPath, 'utf8');
  assert.match(content, /^---\n/);
  assert.match(content, /kind: research-finding/);
  assert.match(content, /confidence: confirmed/);
  assert.match(content, /npm CLI 11\.5\.1\+ required/);
  assert.match(content, /expiresAt: \d{4}-\d{2}-\d{2}T/);
  assert.match(content, /profile: rnd/);
});

test('addResearchFinding rejects confidence=confirmed without sources', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'a2-research-noSources-'));
  t.after(() => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {} });
  await assert.rejects(
    () => addResearchFinding({
      cwd,
      slug: 'no-sources',
      topic: 'Something',
      confidence: 'confirmed',
      sources: [],
      body: 'body',
    }),
    /confirmed requires at least one source/,
  );
});

test('addResearchFinding rejects invalid slug', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'a2-research-slug-'));
  t.after(() => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {} });
  await assert.rejects(
    () => addResearchFinding({
      cwd, slug: 'Invalid Slug!', topic: 'x', body: 'body',
    }),
    /slug must be lowercase/,
  );
});

test('addResearchFinding rejects invalid confidence value', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'a2-research-conf-'));
  t.after(() => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {} });
  await assert.rejects(
    () => addResearchFinding({
      cwd, slug: 'ok', topic: 'x', body: 'body', confidence: 'medium',
    }),
    /confidence must be one of/,
  );
});

test('addResearchFinding stamps active scope id', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'a2-research-profile-'));
  t.after(() => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {} });
  fs.mkdirSync(path.join(cwd, '.cx'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.cx', 'scope.json'), JSON.stringify({
    id: 'marketing',
    displayName: 'Test',
    custom: true,
    roles: ['x'],
    intake: { types: ['x'], stages: ['x'] },
  }));
  const { path: outPath } = await addResearchFinding({
    cwd, slug: 'mkt-finding', topic: 'Marketing topic', body: 'F\n- x',
  });
  const content = fs.readFileSync(outPath, 'utf8');
  assert.match(content, /profile: marketing/);
});
