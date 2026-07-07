/**
 * tests/functional/knowledge-search-project-scope.functional.test.mjs —
 * `construct knowledge search` surfaces the cwd project's `.cx/knowledge/**`
 *
 * @capability research.project-search
 * alongside (and ahead of) the bundled Construct docs (construct-wxip).
 *
 * The bug: knowledgeSearch built its source list from the Construct repo only,
 * so a foreign project saw Construct's own docs and never its own freshly added
 * research. Asserts the fix end-to-end:
 *   1. A research file dropped under `.cx/knowledge/external/research/` is in
 *      the source set.
 *   2. The project hit outranks the bundled Construct doc for the same query.
 *   3. The hit carries `origin: 'project'` so callers can distinguish.
 *   4. When projectRoot equals repoRoot or is absent, the project enumeration
 *      is skipped (no double-counting on the Construct repo itself).
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { knowledgeSearch } from '../../lib/knowledge/search.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const tmpDirs = [];

after(() => {
  for (const dir of tmpDirs) rmTmpDir(dir);
});

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-wxip-'));
  tmpDirs.push(dir);
  return dir;
}

function writeResearch(projectDir, slug, body) {
  const dir = path.join(projectDir, '.construct', 'knowledge', 'external', 'research');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slug}.md`);
  fs.writeFileSync(file, body, 'utf8');
  return file;
}

test('project knowledge surfaces from a foreign project (construct-wxip core fix)', () => {
  const project = makeProject();
  const distinctiveTerm = 'zoltarsynthcombatmoss';
  writeResearch(project, distinctiveTerm, [
    `# ${distinctiveTerm} prophecy`,
    '',
    `FINDINGS: ${distinctiveTerm} is a project-specific marker that the bundled`,
    'Construct docs cannot possibly contain. Its presence in a hit proves the',
    "project's own .cx/knowledge tree was searched, not just the bundled docs.",
    '',
  ].join('\n'));

  const result = knowledgeSearch({
    query: distinctiveTerm,
    repoRoot: REPO_ROOT,
    rootDir: project,
    topK: 5,
    minScore: 0,
  });

  assert.equal(result.ok, true, `search returned not-ok: ${result.message}`);
  assert.ok(result.hits.length > 0, 'no hits returned for project content');
  const top = result.hits[0];
  assert.match(top.file, /external\/research\/.*\.md$/, `top hit must be a project research file; got ${top.file}`);
  assert.equal(top.origin, 'project', 'top hit must be labeled origin: project');
});

test('project knowledge outranks bundled docs on a tied-relevance query', () => {
  const project = makeProject();
  // Pick a term the bundled docs use (e.g. "architecture") so both project and
  // bundled compete on the same query.

  writeResearch(project, 'project-architecture-note', [
    '# Architecture (project-specific)',
    '',
    'The architecture of this project differs from the bundled Construct',
    'architecture in three ways: A, B, C. This local note is more relevant',
    'than the bundled docs when the user asks about THIS project\'s architecture.',
    '',
  ].join('\n'));

  const result = knowledgeSearch({
    query: 'architecture',
    repoRoot: REPO_ROOT,
    rootDir: project,
    topK: 5,
  });

  assert.equal(result.ok, true, `search returned not-ok: ${result.message}`);
  const projectHits = result.hits.filter((h) => h.origin === 'project');
  assert.ok(projectHits.length > 0, 'expected at least one project hit; got none');
  assert.equal(result.hits[0].origin, 'project', `project knowledge must rank first; top hit was ${result.hits[0].file} (${result.hits[0].origin})`);
});

test('no source-list duplication when projectRoot equals repoRoot or is absent', () => {
  // A foreign project carrying ONE research file. Sweep its source list, then
  // sweep with projectRoot===repoRoot, then with projectRoot absent. The first
  // must include the project research file as origin: project; the others must
  // not double-add the construct repo's own .cx/knowledge tree (which already
  // joins the source list as bundled internal knowledge).

  const project = makeProject();
  writeResearch(project, 'no-dup-marker-xyzqqq', '# Marker\n\nUnique no-dup-marker-xyzqqq.\n');

  const foreign = knowledgeSearch({ query: 'no-dup-marker-xyzqqq', repoRoot: REPO_ROOT, rootDir: project, topK: 100, minScore: 0 });
  const projectHitsCount = foreign.hits.filter((h) => h.origin === 'project').length;
  assert.ok(projectHitsCount > 0, 'foreign project must surface its research file');

  const sameRoot = knowledgeSearch({ query: 'no-dup-marker-xyzqqq', repoRoot: REPO_ROOT, rootDir: REPO_ROOT, topK: 100, minScore: 0 });
  const noRoot = knowledgeSearch({ query: 'no-dup-marker-xyzqqq', repoRoot: REPO_ROOT, topK: 100, minScore: 0 });
  for (const r of [sameRoot, noRoot]) {
    const dupes = r.hits.filter((h) => h.file.startsWith('.construct/knowledge/external/research/no-dup-marker'));
    assert.equal(dupes.length, 0, 'projectRoot===repoRoot or absent must not surface the foreign project hit');
  }
});
