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
  roleFindings: { findings: ReadonlyArray<{ id: string; documents: string[]; gist: string }> };
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
  // The earned run surfaces the rung plants and none of the role findings, so
  // every role that owns one shows blind while the run still passes: coverage
  // reports, it does not gate.
  assert.ok(coverage.analyst.every((h) => !h.found));
  assert.ok(coverage.legal.every((h) => !h.found));
  assert.ok(coverage.pm.every((h) => !h.found));
  assert.equal(report.pass, true);
});

test('a role that does surface its own finding is reported found, and only that role', () => {
  // The other half of the property above: blindness has to be a real reading of
  // the run, not a column that is blind whatever happens. One role finding is
  // added to the earned run, and exactly that role stops showing blind.
  const owned = key.roleFindings.findings.find((f) => f.id === 'CP1');
  assert.ok(owned, 'the compliance plant is the stable example this test reads');
  const run = earnedRun() as { claims: Array<unknown> };
  run.claims.push({ kind: 'risk', claim: owned.gist, citations: owned.documents });

  const { report } = score(run);
  const coverage = (report as unknown as { roleCoverage: Record<string, Array<{ found: boolean }>> })
    .roleCoverage;
  assert.ok(coverage.compliance.every((h) => h.found));
  assert.ok(coverage.analyst.every((h) => !h.found));
});

test('every plant a run earns records the claim that earned it', () => {
  const { report } = score(earnedRun());
  const rung1 = (report as unknown as {
    rung1: { plants: Array<{ id: string; found: boolean; by?: { claim: string; citations: string[] } }> };
  }).rung1;
  for (const plant of rung1.plants) {
    assert.ok(plant.found, `${plant.id} should be earned by this run`);
    assert.ok(plant.by, `${plant.id} records no crediting claim`);
    assert.ok((plant.by?.claim ?? '').length > 0);
    assert.ok((plant.by?.citations ?? []).length > 0);
  }
});

test('a plant missed records no crediting claim', () => {
  const run = earnedRun() as { claims: Array<unknown> };
  run.claims = [];
  const { report } = score(run);
  const rung1 = (report as unknown as {
    rung1: { plants: Array<{ found: boolean; by?: unknown }> };
  }).rung1;
  assert.ok(rung1.plants.every((p) => !p.found && p.by === undefined));
});

/**
 * The known limit, held as a test so it cannot be forgotten or quietly assumed
 * fixed. R2's document pair supports two mechanisms — the planted wave-restart
 * loop and the ticket's separate specChanged promotion gap — and both are
 * written in the same words, so a claim about the second satisfies the first's
 * terms. This asserts the false credit still happens, because it does, and that
 * the artifact now names the claim responsible, which is the part that changed.
 */
test('a claim on the neighbouring mechanism still takes the credit, and the score says which claim did', () => {
  const wrongMechanism =
    'The rfc-002-manifest-hydrator.md decision to treat hydration as a ' +
    'first-class feature that pushes to the sync branch explains ' +
    'tickets/T-27949.md: the ApplicationSet controller specChanged status ' +
    'promotion logic advances to Healthy based on the pre-update child state ' +
    'before the generated spec change is applied, breaking the progressive ' +
    'sync trigger.';
  const { report } = score({
    claims: [
      {
        kind: 'risk',
        claim: wrongMechanism,
        citations: ['rfc-002-manifest-hydrator.md', 'tickets/T-27949.md'],
      },
    ],
    notesDrop: { proposals: [], deltas: [] },
  });
  const r2 = (report as unknown as {
    rung2: { plants: Array<{ id: string; found: boolean; by?: { claim: string } }> };
  }).rung2.plants.find((p) => p.id === 'R2');
  assert.equal(r2?.found, true, 'the vocabulary coincidence is real and not yet fixed');
  assert.equal(
    r2?.by?.claim,
    wrongMechanism,
    'the crediting claim must be readable in the score, so the false credit is ' +
      'visible without re-deriving it from the run',
  );
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
