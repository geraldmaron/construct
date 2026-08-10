/**
 * tests/hosts/sources.test.ts — the walk over declared ground: readable
 * documents are found deterministically, build-output directories and non-text
 * files are left out, prose outranks code when the cap bites, and everything
 * that cannot be walked comes back unreachable rather than thrown.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { surveySource } from '../../src/hosts/sources.ts';
import type { Source } from '../../src/kernel/store/sources.ts';

const AT = '2026-08-10T00:00:00.000Z';

function declared(kind: Source['kind'], locator: string): Source {
  return { id: 'src-1', workspace: 'default', kind, locator, addedAt: AT, retiredAt: null };
}

function withGround<T>(fn: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'construct-ground-'));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('a directory survey lists readable documents and skips build output', () => {
  withGround((root) => {
    writeFileSync(join(root, 'plan.md'), '# plan\n');
    writeFileSync(join(root, 'notes.txt'), 'notes\n');
    writeFileSync(join(root, 'logo.png'), 'not text');
    mkdirSync(join(root, 'sub'));
    writeFileSync(join(root, 'sub', 'spec.md'), '# spec\n');
    mkdirSync(join(root, 'node_modules'));
    writeFileSync(join(root, 'node_modules', 'dep.md'), 'a dependency, not ground');
    mkdirSync(join(root, '.hidden'));
    writeFileSync(join(root, '.hidden', 'secret.md'), 'hidden trees are not ground');

    const survey = surveySource(declared('directory', root));
    assert.equal(survey.outcome, 'listed');
    if (survey.outcome !== 'listed') return;
    assert.deepEqual(
      survey.documents.map((d) => d.path),
      [join(root, 'notes.txt'), join(root, 'plan.md'), join(root, 'sub', 'spec.md')],
    );
    assert.equal(survey.total, 3);
    assert.ok(survey.documents.every((d) => d.bytes > 0));
  });
});

test('when the cap bites, prose outranks code and the total still counts everything', () => {
  withGround((root) => {
    writeFileSync(join(root, 'aaa.ts'), 'export {};\n');
    writeFileSync(join(root, 'bbb.ts'), 'export {};\n');
    writeFileSync(join(root, 'zzz-design.md'), '# the document that matters\n');

    const survey = surveySource(declared('directory', root), { cap: 2 });
    assert.equal(survey.outcome, 'listed');
    if (survey.outcome !== 'listed') return;
    assert.equal(survey.total, 3);
    assert.equal(survey.documents.length, 2);
    assert.equal(survey.documents[0]?.path, join(root, 'zzz-design.md'), 'prose first');
  });
});

test('a git kind that is a local checkout walks like a directory', () => {
  withGround((root) => {
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, '.git', 'config'), 'history is not ground');
    writeFileSync(join(root, 'README.md'), '# readme\n');

    const survey = surveySource(declared('git', root));
    assert.equal(survey.outcome, 'listed');
    if (survey.outcome !== 'listed') return;
    assert.deepEqual(
      survey.documents.map((d) => d.path),
      [join(root, 'README.md')],
    );
  });
});

test('what cannot be walked is unreachable with its reason, never a throw', () => {
  const missing = surveySource(declared('directory', join(tmpdir(), 'construct-no-such-dir')));
  assert.equal(missing.outcome, 'unreachable');

  const remote = surveySource(declared('git', 'https://github.com/example/repo.git'));
  assert.equal(remote.outcome, 'unreachable');
  if (remote.outcome === 'unreachable') assert.match(remote.reason, /local checkout/);

  const jira = surveySource(declared('jira', 'PROJ'));
  assert.equal(jira.outcome, 'unreachable');
  if (jira.outcome === 'unreachable') assert.match(jira.reason, /through the host/);
});
