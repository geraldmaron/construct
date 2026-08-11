/**
 * The mechanism judge exists because the structural scorer cannot tell a claim
 * about the planted mechanism from a claim about its neighbour over the same
 * document pair. These tests hold the two properties that make its verdict
 * worth recording.
 *
 * First, the standard it judges against is the plant's gist, which the answer
 * key committed before any run and which the scorer has never read. A judge
 * pointed at anything else would be fitting a standard to results.
 *
 * Second, a plant nobody judged is unjudged rather than credited. The whole
 * point of the pass is that silence about a plant is not evidence for it, and a
 * verdicts file that simply omits an awkward plant must not read as a pass.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repo = join(import.meta.dirname, '..', '..');
const judge = join(repo, 'scripts', 'judge-org-harness-mechanism.mjs');
const key = JSON.parse(
  readFileSync(join(repo, 'fixtures', 'org-harness', 'answer-key.json'), 'utf8'),
) as { risks: ReadonlyArray<{ id: string; gist: string }> };

/** A score file crediting one plant to a claim, which is all the judge reads. */
function scoreCrediting(id: string, claim: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'judge-harness-'));
  const path = join(dir, 'run.score.json');
  writeFileSync(
    path,
    JSON.stringify({
      rung2: { pass: true, plants: [{ id, found: true, by: { claim, citations: [] } }] },
      roleCoverage: {},
    }),
  );
  return path;
}

test('the judging task carries the gist the key committed, not a restatement of it', () => {
  const r2 = key.risks.find((r) => r.id === 'R2');
  assert.ok(r2, 'the fixture key must still define R2');
  const path = scoreCrediting('R2', 'a claim about something else entirely');

  const emitted = execFileSync(process.execPath, [judge, '--emit', path], {
    encoding: 'utf8',
    cwd: repo,
  });

  assert.ok(
    emitted.includes(r2.gist),
    'the judge must be shown the pre-committed gist verbatim; a paraphrase would be a ' +
      'standard authored after the run it grades',
  );
  // Wrapped prose, so the discipline is matched across the line break rather
  // than assumed to sit on one line.
  assert.match(emitted, /Sharing a topic is not sharing a\s+mechanism/);
  assert.match(emitted, /genuinely unsure, answer false/);
});

test('a credited plant nobody judged is recorded unjudged, never as correct', () => {
  const path = scoreCrediting('R2', 'a claim about something else entirely');
  const dir = mkdtempSync(join(tmpdir(), 'judge-verdicts-'));
  const verdicts = join(dir, 'verdicts.json');
  // A verdicts file that simply omits the plant. Silence must not read as a pass.
  writeFileSync(verdicts, JSON.stringify({}));

  execFileSync(
    process.execPath,
    [judge, '--apply', path, '--verdicts', verdicts, '--judge', 'test-model'],
    { encoding: 'utf8', cwd: repo },
  );

  const judged = JSON.parse(readFileSync(path.replace(/\.score\.json$/, '.judged.json'), 'utf8')) as {
    judgedBy: string;
    results: ReadonlyArray<{ plant: string; statesMechanism: boolean | null }>;
    falseCredits: readonly string[];
  };
  assert.equal(judged.results[0]?.statesMechanism, null);
  assert.deepEqual(judged.falseCredits, [], 'unjudged is not the same as refuted');
  assert.equal(judged.judgedBy, 'test-model', 'a verdict records who reached it');
});

test('a refused claim is recorded as a false credit beside the structural pass', () => {
  const path = scoreCrediting('R2', 'a claim about the neighbouring mechanism');
  const dir = mkdtempSync(join(tmpdir(), 'judge-verdicts-'));
  const verdicts = join(dir, 'verdicts.json');
  writeFileSync(
    verdicts,
    JSON.stringify({ R2: { statesMechanism: false, why: 'different mechanism, same documents' } }),
  );

  execFileSync(
    process.execPath,
    [judge, '--apply', path, '--verdicts', verdicts, '--judge', 'test-model'],
    { encoding: 'utf8', cwd: repo },
  );

  const judged = JSON.parse(readFileSync(path.replace(/\.score\.json$/, '.judged.json'), 'utf8')) as {
    results: ReadonlyArray<{ plant: string; structuralFound: boolean; statesMechanism: boolean | null }>;
    falseCredits: readonly string[];
    correlatedError: string;
  };
  assert.deepEqual(judged.falseCredits, ['R2']);
  assert.equal(
    judged.results[0]?.structuralFound,
    true,
    'the structural result stands as recorded; the judgment sits beside it',
  );
  assert.match(judged.correlatedError, /upper bound/);
});
