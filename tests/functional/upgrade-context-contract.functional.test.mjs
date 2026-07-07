/**
 * tests/functional/upgrade-context-contract.functional.test.mjs
 *
 * Migration-gate contract for the .cx/context.* upgrade decision (self-audit construct-rr63.3.2,
 * owner decision construct-rr63.3.1: CONSENTED RE-CONVERGE — upgrades may re-converge .cx/context.*
 * only after explicit consent; the default preserves user edits). refreshContextMd
 * (lib/tracking-surfaces.mjs) rewrites only its managed sections and takes no force/consent
 * parameter, so a refresh cannot silently re-converge user-authored content. These tests pin the
 * default-preserve half of the decision as an upgrade invariant: across REPEATED refreshes (i.e.
 * repeated upgrade cycles) user content never drifts. The existing tracking-surfaces.test.mjs
 * covers single-refresh preservation; this adds the across-upgrades idempotency the decision needs.
 *
 * Adjudication (Opus): the rest of this bead's nominal scope is already covered — v0->v2 upgrade
 * fixtures by tests/functional/w4-lifecycle-migrations.functional.test.mjs, XDG/HOME isolation
 * resolvers by tests/xdg-config.test.mjs, and context preservation by tests/tracking-surfaces.test.mjs.
 * The remaining sub-gaps (a non-silent dirty-repo warning and the Wave-4 consent re-converge PATH)
 * are split to a follow-on bead.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { refreshContextMd, reconvergeContextMd } from '../../lib/tracking-surfaces.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const USER_SECTION = `## Hand-curated section

This is user content; an upgrade refresh must never re-converge it without consent.
- a load-bearing note the user wrote
`;

function seed(rootDir) {
  mkdirSync(join(rootDir, '.construct'), { recursive: true });
  writeFileSync(join(rootDir, '.construct', 'context.md'), `# context\n\n## Active Work\n\n_None in progress._\n\n## Recent Decisions\n\n_No recent decisions captured._\n\n## Architecture Notes\n\n_No new architecture notes._\n\n${USER_SECTION}`, 'utf8');
  writeFileSync(join(rootDir, '.construct', 'context.json'), JSON.stringify({ format: 'json' }), 'utf8');
}

function extractUserSection(rootDir) {
  const body = readFileSync(join(rootDir, '.construct', 'context.md'), 'utf8');
  const idx = body.indexOf('## Hand-curated section');
  return idx === -1 ? null : body.slice(idx);
}

const dirs = [];
let savedPath;
function makeProject() {
  const rootDir = mkdtempSync(join(tmpdir(), 'cx-upgrade-ctx-'));
  const shimDir = mkdtempSync(join(tmpdir(), 'cx-upgrade-shim-'));
  dirs.push(rootDir, shimDir);
  writeFileSync(join(shimDir, 'bd'), '#!/usr/bin/env bash\nif [[ "$1" == "list" ]]; then echo "[]"; fi\n', { mode: 0o755 });
  savedPath = process.env.PATH;
  process.env.PATH = `${shimDir}:${savedPath}`;
  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: rootDir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: rootDir });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: rootDir });
  seed(rootDir);
  return rootDir;
}
test.after(() => { if (savedPath) process.env.PATH = savedPath; for (const d of dirs) { try { rmTmpDir(d); } catch {} } });

test('a single upgrade refresh preserves user-authored content byte-for-byte', async () => {
  const rootDir = makeProject();
  const before = extractUserSection(rootDir);
  const result = await refreshContextMd({ rootDir });
  assert.equal(result.ok, true);
  assert.equal(extractUserSection(rootDir), before, 'user section unchanged after refresh');
});

test('repeated upgrade refreshes never drift user content (consent contract: no silent re-converge)', async () => {
  const rootDir = makeProject();
  const original = extractUserSection(rootDir);
  for (let cycle = 0; cycle < 3; cycle += 1) {
    const result = await refreshContextMd({ rootDir });
    assert.equal(result.ok, true, `refresh cycle ${cycle} ok`);
    assert.equal(extractUserSection(rootDir), original, `user content identical after upgrade cycle ${cycle}`);
  }
});

test('the managed-section structure survives refresh (refresh updates managed, not user, regions)', async () => {
  const rootDir = makeProject();
  await refreshContextMd({ rootDir });
  const body = readFileSync(join(rootDir, '.construct', 'context.md'), 'utf8');
  for (const heading of ['## Active Work', '## Recent Decisions', '## Architecture Notes', '## Hand-curated section']) {
    assert.ok(body.includes(heading), `${heading} present after refresh`);
  }
});

test('re-converge WITHOUT consent refuses and preserves the file (decision default)', async () => {
  const rootDir = makeProject();
  const before = extractUserSection(rootDir);
  const result = await reconvergeContextMd({ rootDir });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'consent-required');
  assert.equal(result.preserved, true);
  assert.equal(extractUserSection(rootDir), before, 'no consent means the file is untouched');
});

test('re-converge WITH consent resets to the scaffold, discarding user drift', async () => {
  const rootDir = makeProject();
  assert.ok(extractUserSection(rootDir), 'user content present before re-converge');
  const result = await reconvergeContextMd({ rootDir, consent: true });
  assert.equal(result.ok, true);
  assert.equal(result.reconverged, true);
  assert.equal(extractUserSection(rootDir), null, 'consented re-converge removes user drift');
  const body = readFileSync(join(rootDir, '.construct', 'context.md'), 'utf8');
  for (const heading of ['## Active Work', '## Recent Decisions', '## Architecture Notes', '## Open Questions']) {
    assert.ok(body.includes(heading), `scaffold heading ${heading} present after re-converge`);
  }
});

test('re-converge refuses cleanly when context.md is absent', async () => {
  const rootDir = makeProject();
  rmSync(join(rootDir, '.construct', 'context.md'));
  const result = await reconvergeContextMd({ rootDir, consent: true });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-context-md');
});
