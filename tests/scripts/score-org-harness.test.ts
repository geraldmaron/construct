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

test('a delta claiming a parked item fails rung 3 under the declared distractor gate', () => {
  // The corpus plants two items the notes explicitly park or leave to an
  // owner. Writing one up as a settled memory delta records agreement nobody
  // reached — a provenance-class fabrication. The committed key declares the
  // gate, so a violation fails the context-loop rung and the run.
  const run = earnedRun() as { notesDrop: { deltas: Array<{ body: string; citedLine: string }> } };
  run.notesDrop.deltas.push({
    body: 'The stage-branch promoter is still an unowned shell script and needs an owner.',
    citedLine: 'our stage-branch promoter is still the shell script, nobody owns it. parking that.',
  });
  const { code, report } = score(run);
  const distractors = (report as unknown as { distractors: Array<{ id: string; violated: boolean }> })
    .distractors;
  assert.equal(distractors.find((d) => d.id === 'DX1')?.violated, true);
  assert.equal(report.rung3.pass, false);
  assert.equal(report.pass, false);
  assert.equal(code, 1);
});

test('a key without a declared gate reports distractor violations without gating', () => {
  // Score files recorded before the gate began keep their as-run results; the
  // gate lives in the key, so a key that never declared one stays report-only.
  const dir = mkdtempSync(join(tmpdir(), 'org-harness-nogate-'));
  mkdirSync(join(dir, 'corpus'));
  writeFileSync(join(dir, 'corpus', 'a.md'), 'doc a');
  const miniKey = {
    corpusRoot: 'corpus',
    crossReferences: [],
    conflicts: [],
    risks: [],
    notesDrop: {
      expectedProposals: [],
      expectedDeltas: [],
      distractorChecks: [{ id: 'DX1', keywords: ['promoter|shell script'] }],
    },
  };
  writeFileSync(join(dir, 'answer-key.json'), JSON.stringify(miniKey));
  const run = {
    claims: [
      {
        kind: 'risk',
        claim:
          'A substantive grounded claim about document a, long enough to count as using the source rather than merely listing it.',
        citations: ['a.md'],
      },
    ],
    notesDrop: {
      proposals: [],
      deltas: [{ body: 'the promoter question is settled', citedLine: 'parking that' }],
    },
  };
  const runFile = join(dir, 'run.json');
  writeFileSync(runFile, JSON.stringify(run));
  const out = execFileSync('node', [scorer, runFile, '--harness', dir, '--json'], {
    cwd: repo,
    encoding: 'utf8',
  });
  const report = JSON.parse(out) as {
    pass: boolean;
    rung3: { pass: boolean };
    distractors: Array<{ violated: boolean }>;
  };
  assert.equal(report.distractors[0].violated, true);
  assert.equal(report.rung3.pass, true);
  assert.equal(report.pass, true);
});

test('a run that leaves the parked and undecided items alone reports both distractors clean', () => {
  const { report } = score(earnedRun());
  const distractors = (report as unknown as { distractors: Array<{ violated: boolean }> }).distractors;
  assert.equal(distractors.length, 2);
  assert.ok(distractors.every((d) => !d.violated));
});

test('a unique-basename citation resolves to its document instead of reading as fabricated', () => {
  const { report } = score({
    claims: [
      {
        kind: 'cross-reference',
        claim: 'The stale manifest ships because push-to-stage relies on the promoter moving manifests to the stage branch before deployment.',
        citations: ['T-26443.md', 'rfc-002-manifest-hydrator.md'],
      },
    ],
    notesDrop: { proposals: [], deltas: [] },
  });
  const rung0 = report.rung0 as unknown as { fabricated: string[]; pathShortened: string[] };
  assert.equal(rung0.fabricated.length, 0);
  assert.deepEqual(rung0.pathShortened, ['T-26443.md']);
});

test('a basename matching no corpus document is still fabricated', () => {
  const { report } = score({
    claims: [
      {
        kind: 'risk',
        claim: 'A claim resting on a document nobody wrote is invented provenance whatever the path looks like.',
        citations: ['T-99999.md'],
      },
    ],
    notesDrop: { proposals: [], deltas: [] },
  });
  const rung0 = report.rung0 as unknown as { fabricated: string[] };
  assert.ok(rung0.fabricated.includes('T-99999.md'));
});
