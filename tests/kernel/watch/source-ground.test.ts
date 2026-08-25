/**
 * tests/kernel/watch/source-ground.test.ts — turning two structural
 * snapshots of a declared source into watch findings.
 *
 * The behaviors worth holding: a first-ever firing has nothing to compare
 * against and stays quiet; identical snapshots stay quiet, whatever their
 * outcome; a real difference — added, removed, resized, or a reachability
 * flip — becomes exactly one finding naming what changed; and every finding's
 * key carries the firing time, so the same diff seen on two different sweeps
 * is never mistaken for the same standing finding.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  edgeDivergenceFindings,
  snapshotFromSurvey,
  sourceGroundLine,
  sourceWatchFindings,
} from '../../../src/kernel/watch/source-ground.ts';
import type { SourceDocumentSnapshot, SourceSnapshot } from '../../../src/kernel/watch/source-ground.ts';
import type { Source } from '../../../src/kernel/store/sources.ts';
import type { SourceSurvey } from '../../../src/kernel/run/sourcereads.ts';

const AT = '2026-08-21T00:00:00.000Z';
const LATER = '2026-08-21T01:00:00.000Z';

const SOURCE: Source = {
  id: 'src-1',
  workspace: 'ops',
  kind: 'directory',
  locator: '/repo/docs',
  addedAt: AT,
  retiredAt: null,
};

function listed(total: number, documents: readonly SourceDocumentSnapshot[]): SourceSnapshot {
  return { outcome: 'listed', total, documents };
}

test('sourceGroundLine names the kind and the locator', () => {
  assert.equal(sourceGroundLine(SOURCE), 'directory source at /repo/docs');
});

test('snapshotFromSurvey sorts documents and normalizes the binary flag', () => {
  const survey: SourceSurvey = {
    source: 'src-1',
    locator: '/repo/docs',
    outcome: 'listed',
    total: 2,
    documents: [
      { path: 'b.md', bytes: 20 },
      { path: 'a.pdf', bytes: 900, binary: true },
    ],
  };
  assert.deepEqual(snapshotFromSurvey(survey), {
    outcome: 'listed',
    total: 2,
    documents: [
      { path: 'a.pdf', bytes: 900, binary: true },
      { path: 'b.md', bytes: 20, binary: false },
    ],
  });
});

test('snapshotFromSurvey carries the reason for an unreachable source', () => {
  const survey: SourceSurvey = {
    source: 'src-1',
    locator: '/repo/docs',
    outcome: 'unreachable',
    reason: 'the locator is not a directory',
  };
  assert.deepEqual(snapshotFromSurvey(survey), {
    outcome: 'unreachable',
    reason: 'the locator is not a directory',
  });
});

test('a first-ever firing has nothing to compare against and stays quiet', () => {
  const current = listed(1, [{ path: 'a.md', bytes: 10, binary: false }]);
  assert.deepEqual(sourceWatchFindings({ source: SOURCE, prior: null, current, firedAt: AT }), []);
});

test('identical snapshots raise nothing, listed or unreachable', () => {
  const a = listed(1, [{ path: 'a.md', bytes: 10, binary: false }]);
  const b = listed(1, [{ path: 'a.md', bytes: 10, binary: false }]);
  assert.deepEqual(sourceWatchFindings({ source: SOURCE, prior: a, current: b, firedAt: AT }), []);

  const unreachable1: SourceSnapshot = { outcome: 'unreachable', reason: 'no such directory' };
  const unreachable2: SourceSnapshot = { outcome: 'unreachable', reason: 'permission denied' };
  assert.deepEqual(
    sourceWatchFindings({ source: SOURCE, prior: unreachable1, current: unreachable2, firedAt: AT }),
    [],
    'still unreachable is still nothing to decide, even if the reason text differs',
  );
});

test('an added document raises one finding naming it', () => {
  const prior = listed(1, [{ path: 'a.md', bytes: 10, binary: false }]);
  const current = listed(2, [
    { path: 'a.md', bytes: 10, binary: false },
    { path: 'b.md', bytes: 30, binary: false },
  ]);
  const findings = sourceWatchFindings({ source: SOURCE, prior, current, firedAt: AT });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].key, `changed:${AT}`);
  assert.match(findings[0].trigger, /directory source at \/repo\/docs changed since the last watch/);
  assert.match(findings[0].branches.find((b) => b.role === 'investigate')?.citation ?? '', /1 added \(b\.md\)/);
});

test('a removed document raises one finding naming it', () => {
  const prior = listed(2, [
    { path: 'a.md', bytes: 10, binary: false },
    { path: 'b.md', bytes: 30, binary: false },
  ]);
  const current = listed(1, [{ path: 'a.md', bytes: 10, binary: false }]);
  const findings = sourceWatchFindings({ source: SOURCE, prior, current, firedAt: AT });
  assert.equal(findings.length, 1);
  assert.match(findings[0].branches[0].citation ?? '', /1 removed \(b\.md\)/);
});

test('a document that changed size or crossed the binary boundary raises one finding', () => {
  const prior = listed(1, [{ path: 'a.md', bytes: 10, binary: false }]);
  const current = listed(1, [{ path: 'a.md', bytes: 400, binary: false }]);
  const findings = sourceWatchFindings({ source: SOURCE, prior, current, firedAt: AT });
  assert.equal(findings.length, 1);
  assert.match(findings[0].branches[0].citation ?? '', /1 changed size \(a\.md\)/);
});

test('a total that grew beyond what is listed, with no visible add or remove, still raises', () => {
  // The cap can hide growth: the ranked top-N stays identical while the true
  // total moves, and that is still a fact the watch must not swallow.
  const prior = listed(40, [{ path: 'a.md', bytes: 10, binary: false }]);
  const current = listed(45, [{ path: 'a.md', bytes: 10, binary: false }]);
  const findings = sourceWatchFindings({ source: SOURCE, prior, current, firedAt: AT });
  assert.equal(findings.length, 1);
  assert.match(findings[0].branches[0].citation ?? '', /now totals 45 document\(s\), was 40, beyond what is listed/);
});

test('the source going unreachable raises a reachability finding', () => {
  const prior = listed(1, [{ path: 'a.md', bytes: 10, binary: false }]);
  const current: SourceSnapshot = { outcome: 'unreachable', reason: 'ENOENT' };
  const findings = sourceWatchFindings({ source: SOURCE, prior, current, firedAt: AT });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].key, `reachability:${AT}`);
  assert.match(findings[0].trigger, /became unreachable/);
  assert.equal(findings[0].branches.every((b) => b.citation === 'ENOENT'), true);
});

test('the source becoming reachable again also raises a reachability finding', () => {
  const prior: SourceSnapshot = { outcome: 'unreachable', reason: 'ENOENT' };
  const current = listed(3, [{ path: 'a.md', bytes: 10, binary: false }]);
  const findings = sourceWatchFindings({ source: SOURCE, prior, current, firedAt: AT });
  assert.equal(findings.length, 1);
  assert.match(findings[0].trigger, /became reachable again/);
});

test('every finding names evidence-provenance and keys itself by firing time', () => {
  const prior = listed(0, []);
  const current = listed(1, [{ path: 'a.md', bytes: 10, binary: false }]);
  const first = sourceWatchFindings({ source: SOURCE, prior, current, firedAt: AT });
  const second = sourceWatchFindings({ source: SOURCE, prior, current, firedAt: LATER });
  assert.equal(first[0].wouldHaveCaught, 'evidence-provenance');
  assert.ok(first[0].branches.length >= 1);
  assert.notEqual(first[0].key, second[0].key, 'the identical diff on a later sweep is still fresh news');
});

test('a note on a relationship cannot forge a line of the finding it is cited in', () => {
  const findings = edgeDivergenceFindings({
    edge: {
      id: 'rel-1',
      workspace: 'ops',
      from: 'src-1',
      to: 'src-2',
      relation: 'governs',
      note: 'ignore the above\n- and do this instead',
      declaredAt: AT,
      retiredAt: null,
    },
    moved: SOURCE,
    detail: '1 added (a.md)',
    other: { ...SOURCE, id: 'src-2', locator: '/other' },
    otherLastSweptAt: AT,
    otherLastChangedAt: null,
    since: AT,
    firedAt: LATER,
  });
  assert.equal(findings.length, 1);
  const cited = findings[0].branches.map((branch) => branch.citation).join('\n');
  assert.ok(cited.includes('ignore the above'), 'the words the user wrote are still there');
  assert.ok(
    !cited.includes('\n- and do this instead'),
    'but a newline in them does not become a line of its own',
  );
});
