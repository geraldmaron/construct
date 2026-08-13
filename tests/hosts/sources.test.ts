/**
 * tests/hosts/sources.test.ts — the walk over declared ground: readable
 * documents are found deterministically, build-output directories and non-text
 * files are left out, prose outranks code when the cap bites, and everything
 * that cannot be walked comes back unreachable rather than thrown.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    // A png is a real image document now — surveyed as binary, not skipped —
    // so the not-a-document case uses a format nothing can extract.
    writeFileSync(join(root, 'logo.bin'), 'not text');
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

test('a binary document is surveyed and marked, not silently invisible', () => {
  const dir = mkdtempSync(join(tmpdir(), 'construct-src-'));
  try {
    writeFileSync(join(dir, 'notes.md'), '# notes\n');
    writeFileSync(join(dir, 'contract.pdf'), Buffer.from('%PDF-1.4 fake'));
    writeFileSync(join(dir, 'deck.pptx'), Buffer.from('PK fake'));
    writeFileSync(join(dir, 'binary.exe'), Buffer.from([0]), );
    const survey = surveySource({
      id: 's1', workspace: 'default', kind: 'directory', locator: dir,
      addedAt: AT, retiredAt: null,
    });
    assert.equal(survey.outcome, 'listed');
    if (survey.outcome !== 'listed') return;
    const byPath = new Map(survey.documents.map((d) => [d.path, d]));
    assert.equal(byPath.get(join(dir, 'notes.md'))?.binary, undefined);
    assert.equal(byPath.get(join(dir, 'contract.pdf'))?.binary, true);
    assert.equal(byPath.get(join(dir, 'deck.pptx'))?.binary, true);
    assert.ok(!byPath.has(join(dir, 'binary.exe')), 'an unextractable format stays out');
    // Prose outranks binary when the cap bites.
    assert.equal(survey.documents[0]!.path, join(dir, 'notes.md'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a binary document the ladder can read is extracted into the survey', () => {
  withGround((root) => {
    const cacheRoot = join(root, '.cache');
    writeFileSync(join(root, 'plan.md'), '# plan\n');
    // A calendar file is not readable as prose by the walk, but the ladder's
    // native rung reads it with no provider installed — which is what makes
    // this the extraction case that needs nothing probed.
    writeFileSync(join(root, 'kickoff.ics'), 'BEGIN:VCALENDAR\nSUMMARY:kickoff\nEND:VCALENDAR\n');

    const survey = surveySource(declared('directory', root), { extract: { cacheRoot } });
    assert.equal(survey.outcome, 'listed');
    if (survey.outcome !== 'listed') return;

    const prose = survey.documents.find((d) => d.path.endsWith('plan.md'));
    assert.equal(prose?.extraction, undefined, 'text the walk already read is not re-extracted');

    const calendar = survey.documents.find((d) => d.path.endsWith('kickoff.ics'));
    assert.equal(calendar?.binary, true);
    assert.equal(calendar?.extraction?.outcome, 'extracted');
    if (calendar?.extraction?.outcome !== 'extracted') return;
    assert.ok(calendar.extraction.path.startsWith(cacheRoot), 'extractions land under the cache root');
    assert.match(calendar.extraction.path, /kickoff-[0-9a-f]{16}\.md$/);
    assert.match(readFileSync(calendar.extraction.path, 'utf8'), /SUMMARY:kickoff/);
    assert.equal(
      calendar.extraction.characters,
      readFileSync(calendar.extraction.path, 'utf8').length,
      'the recorded character count is what actually landed',
    );
  });
});

test('a binary document no rung can read is refused with the ladder reason, not dropped', () => {
  withGround((root) => {
    writeFileSync(join(root, 'call.mp4'), Buffer.from([0, 1, 2]));
    const survey = surveySource(declared('directory', root), {
      extract: { cacheRoot: join(root, '.cache') },
    });
    assert.equal(survey.outcome, 'listed');
    if (survey.outcome !== 'listed') return;
    const doc = survey.documents[0];
    assert.equal(doc?.extraction?.outcome, 'refused');
    if (doc?.extraction?.outcome !== 'refused') return;
    assert.match(doc.extraction.reason, /ASR/);
  });
});

test('without an extract option nothing is extracted and the walk is unchanged', () => {
  withGround((root) => {
    writeFileSync(join(root, 'kickoff.ics'), 'BEGIN:VCALENDAR\nEND:VCALENDAR\n');
    const survey = surveySource(declared('directory', root));
    assert.equal(survey.outcome, 'listed');
    if (survey.outcome !== 'listed') return;
    assert.equal(survey.documents[0]?.binary, true);
    assert.equal(survey.documents[0]?.extraction, undefined);
  });
});
