/**
 * tests/functional/init-host-footprint.functional.test.mjs
 *
 * Regression guard for the ADR-0027 §2 host-footprint contract: a freshly
 * `construct init`'d repo must not present Construct-the-tool as project content.
 * One real init, then assertions on the durable artifacts:
 *   - construct_guide.md is in the ignored .construct/ tree, never the repo root
 *   - AGENTS.md is the project header + marker blocks, with no un-fenced doctrine
 *   - docs/README.md indexes only the scaffolded lanes, with no `construct` commands
 *   - inbox/ is covered by the host .gitignore with no local keep-file
 *   - git status shows no Construct-generated file masquerading as project content
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'construct');

function initProject() {
  const dir = mkdtempSync(join(tmpdir(), 'init-host-footprint-'));
  const home = mkdtempSync(join(tmpdir(), 'init-host-footprint-home-'));
  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'footprint@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Footprint Test'], { cwd: dir });
  const result = spawnSync(
    process.execPath,
    [BIN, 'init', '--yes', '--no-start', '--with-adrs', '--with-runbooks'],
    {
      cwd: dir,
      encoding: 'utf8',
      timeout: 120_000,
      env: {
        ...process.env,
        CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
        BOOTSTRAP_CHECKED: '1',
        HOME: home,
        CONSTRUCT_HOME_OVERRIDE: home,
      },
    },
  );
  return { dir, home, result };
}

test('construct init produces a host footprint that does not conflate Construct with the project', (t) => {
  const { dir, home, result } = initProject();
  t.after(() => {
    rmTmpDir(dir);
    rmTmpDir(home);
  });
  assert.equal(result.status, 0, `init exited ${result.status}: ${result.stderr}`);

  // construct_guide.md: dot-scoped, never at the repo root.
  assert.ok(!existsSync(join(dir, 'construct_guide.md')), 'construct_guide.md must not be at the repo root');
  assert.ok(existsSync(join(dir, '.construct', 'construct_guide.md')), 'construct_guide.md belongs in .construct/');

  // AGENTS.md: project header + marker blocks, no un-fenced doctrine.
  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  assert.match(agents, /<!-- BEGIN CONSTRUCT INTEGRATION/, 'AGENTS.md must carry the fenced integration block');
  assert.ok(!agents.includes('## Operating hierarchy'), 'AGENTS.md must not carry the legacy doctrine');
  assert.ok(!agents.includes('construct-6uo'), 'AGENTS.md must not leak an internal Construct bead id');

  // docs/README.md: only the scaffolded lanes, no tool commands as project policy.
  const docsReadme = readFileSync(join(dir, 'docs', 'README.md'), 'utf8');
  assert.match(docsReadme, /\[ADRs\]\(\.\/adr\/\)/, 'docs/README lists the adr lane');
  assert.match(docsReadme, /\[Runbooks\]\(\.\/runbooks\/\)/, 'docs/README lists the runbooks lane');
  assert.ok(!docsReadme.includes('](./briefs/)'), 'docs/README must not advertise unscaffolded lanes');
  assert.ok(!/construct docs:verify|construct init:update/.test(docsReadme), 'docs/README must not bake in tool commands');

  // inbox/: ignored centrally, no local keep-file.
  const rootGitignore = readFileSync(join(dir, '.gitignore'), 'utf8');
  assert.match(rootGitignore, /^inbox\/$/m, 'inbox/ must be in the host .gitignore');
  assert.ok(!existsSync(join(dir, 'inbox', '.gitignore')), 'no local inbox/.gitignore keep-file');

  // git status: nothing Construct-generated masquerading as project content.
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }).stdout;
  assert.ok(!/construct_guide\.md/.test(status), 'construct_guide.md must not appear in git status');
  assert.ok(!/^\?\?\s+inbox\//m.test(status), 'inbox/ must not appear in git status');
});
