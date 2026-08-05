/**
 * The harness scorer must be as hard to please as the answer key says
 *.
 *
 * The fixture organization's answer key was recorded before any run, and the
 * scorer is the only thing standing between that key and a run claiming
 * grounded synthesis it did not perform. So the tests here are the two ways a
 * scorer quietly rots: passing a run that earned it (fine) and passing a run
 * that fabricated a citation, skipped a plant, or listed documents instead of
 * using them (not fine). Each failure mode is exercised against the real
 * committed corpus and key, not a mock of them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repo = join(import.meta.dirname, '..', '..');
const scorer = join(repo, 'scripts', 'score-org-harness.mjs');
const key = JSON.parse(
  readFileSync(join(repo, 'fixtures', 'org-harness', 'answer-key.json'), 'utf8'),
) as {
  crossReferences: ReadonlyArray<{ documents: string[]; gist: string }>;
  conflicts: ReadonlyArray<{ documents: string[]; gist: string }>;
  risks: ReadonlyArray<{ documents: string[]; gist: string }>;
  notesDrop: {
    expectedProposals: ReadonlyArray<{ target: string; gist: string; noteLineKeywords: string[] }>;
    expectedDeltas: ReadonlyArray<{ gist: string; noteLineKeywords: string[] }>;
  };
};

/** A line of note text that satisfies a plant's AND-of-OR line keywords. */
const lineFor = (terms: readonly string[]): string =>
  terms.map((t) => t.split('|')[0]).join(' — ');

/** A run that earns every gate: each plant surfaced, cited, and used. */
function earnedRun(): unknown {
  return {
    claims: [
      ...key.crossReferences.map((p) => ({
        kind: 'cross-reference',
        claim: p.gist,
        citations: p.documents,
      })),
      ...key.conflicts.map((p) => ({ kind: 'conflict', claim: p.gist, citations: p.documents })),
      ...key.risks.map((p) => ({ kind: 'risk', claim: p.gist, citations: p.documents })),
    ],
    notesDrop: {
      proposals: key.notesDrop.expectedProposals.map((p) => ({
        target: p.target,
        change: p.gist,
        citedLine: lineFor(p.noteLineKeywords),
      })),
      deltas: key.notesDrop.expectedDeltas.map((d) => ({
        body: d.gist,
        citedLine: lineFor(d.noteLineKeywords),
      })),
    },
  };
}

function score(run: unknown): { code: number; report: Record<string, { pass: boolean }> & { pass: boolean } } {
  const dir = mkdtempSync(join(tmpdir(), 'org-harness-'));
  const file = join(dir, 'run.json');
  writeFileSync(file, JSON.stringify(run));
  try {
    const out = execFileSync('node', [scorer, file, '--json'], { cwd: repo, encoding: 'utf8' });
    return { code: 0, report: JSON.parse(out) };
  } catch (err) {
    const e = err as { status: number; stdout: string };
    return { code: e.status, report: JSON.parse(e.stdout) };
  }
}

test('a run that surfaces every plant with citations passes every rung', () => {
  const { code, report } = score(earnedRun());
  assert.equal(code, 0);
  assert.equal(report.pass, true);
});

test('role coverage reports blindness without gating the rungs', () => {
  const { code, report } = score(earnedRun());
  assert.equal(code, 0);
  const coverage = (report as unknown as { roleCoverage: Record<string, Array<{ found: boolean }>> })
    .roleCoverage;
  // The earned run surfaces the rung plants but none of the role-lens
  // findings: every role mapped only to those findings shows blind, and the
  // run still passes — coverage is advisory.
  assert.ok(coverage.analyst.every((h) => !h.found));
  assert.ok(coverage.legal.every((h) => !h.found));
  assert.ok(coverage.pm.every((h) => h.found));
});

test('a fabricated citation fails rung 0 even when every plant is found', () => {
  const run = earnedRun() as { claims: Array<{ citations: string[] }> };
  run.claims[0].citations = [...run.claims[0].citations, 'tickets/T-99999.md'];
  const { code, report } = score(run);
  assert.equal(code, 1);
  assert.equal(report.rung0.pass, false);
});

test('a missed planted risk fails rung 2', () => {
  const run = earnedRun() as { claims: Array<{ kind: string }> };
  run.claims = run.claims.filter((c) => c.kind !== 'risk');
  const { report } = score(run);
  assert.equal(report.rung2.pass, false);
});

test('listing documents instead of using them fails the substantive gate', () => {
  const run = earnedRun() as { claims: Array<{ kind: string; claim: string; citations: string[] }> };
  for (const c of run.claims) if (c.kind !== 'risk') c.claim = c.claim.slice(0, 10);
  // Risks keep their keyword match, but the run is now mostly bare listings.
  const { report } = score(run);
  assert.equal(report.rung2.pass, false);
});

test('a propagation proposal on the wrong ticket fails rung 3', () => {
  const run = earnedRun() as { notesDrop: { proposals: Array<{ target: string }> } };
  run.notesDrop.proposals[0].target = 'tickets/T-29001.md';
  const { report } = score(run);
  assert.equal(report.rung3.pass, false);
});

test('identifier vocabulary matches its spaced form: destinationServiceAccounts satisfies "service account"', () => {
  // The real second scored run stated a planted risk's exact mechanism but
  // wrote the identifier form of the key's term and was scored a miss; the
  // scorer now collapses case and separators on both sides before matching.
  const dir = mkdtempSync(join(tmpdir(), 'org-harness-mini-'));
  mkdirSync(join(dir, 'corpus'));
  writeFileSync(join(dir, 'corpus', 'a.md'), 'doc a');
  writeFileSync(join(dir, 'corpus', 'b.md'), 'doc b');
  const miniKey = {
    corpusRoot: 'corpus',
    crossReferences: [],
    conflicts: [],
    risks: [
      {
        id: 'R',
        documents: ['a.md', 'b.md'],
        keywords: ['service account', 'push-to-stage'],
      },
    ],
    notesDrop: { expectedProposals: [], expectedDeltas: [] },
  };
  writeFileSync(join(dir, 'answer-key.json'), JSON.stringify(miniKey));
  const run = {
    claims: [
      {
        kind: 'risk',
        claim:
          'The destinationServiceAccounts credential is what the push to stage runs as, and that combination is the risk this claim ties together.',
        citations: ['a.md', 'b.md'],
      },
    ],
    notesDrop: { proposals: [], deltas: [] },
  };
  const runFile = join(dir, 'run.json');
  writeFileSync(runFile, JSON.stringify(run));
  const out = execFileSync('node', [scorer, runFile, '--harness', dir, '--json'], {
    cwd: repo,
    encoding: 'utf8',
  });
  const report = JSON.parse(out) as { rung2: { pass: boolean } };
  assert.equal(report.rung2.pass, true);
});

test('a memory delta that cannot cite its note line fails rung 3', () => {
  const run = earnedRun() as { notesDrop: { deltas: Array<{ citedLine: string }> } };
  run.notesDrop.deltas[0].citedLine = 'unrelated words';
  const { report } = score(run);
  assert.equal(report.rung3.pass, false);
});
