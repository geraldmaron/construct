/** Synthetic validator fixtures only: these records are never native qualification. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SEMANTIC_OBLIGATIONS,
  semanticReviewPrompt,
  reviewDigest,
  reviewContractDigest,
  semanticJudgmentProblems,
} from '../../src/kernel/workflow/semantic-review.ts';
import { checkExperimental, checkRelease, repositoryFile, sha256 } from '../../scripts/release-gate.mjs';
import { WITHOUT_NATIVE_REVIEW } from '../../scripts/experimental-live.mjs';
import { CASES, REQUEST, DISCLOSURES } from '../../scripts/experimental-cases.mjs';
import { beginExperimentalAttempt } from '../../scripts/experimental-live.mjs';
const digest = 'test-surface',
  now = Date.parse('2026-10-10T01:00:00Z');
function fixture() {
  const records: any[] = [];
  const files = new Map<string, Buffer>();
  for (const c of CASES) {
    const contract = {
      request: { input: { request: REQUEST } },
      obligations: SEMANTIC_OBLIGATIONS,
      reviewer: { digest: 'a'.repeat(64), profile: 'codex-app-server-held-text-v2' },
    };
    const bundle: any = {
      formatVersion: 1,
      canonicalization: 'utf16-codeunit-v1',
      runId: 'run',
      stepRunId: 'step',
      attempt: 1,
      contract,
      contractDigest: '',
      body: { summary: c.answer },
      artifacts: [{ ref: 'answer.md', content: { text: c.answer } }],
      evidence: [{ ref: 'source.txt', content: { text: c.source } }],
      problems: [],
    };
    bundle.contractDigest = reviewContractDigest(bundle);
    const judgment = {
      checks: SEMANTIC_OBLIGATIONS.map((o) => ({
        id: o.id,
        verdict: c.expected === 'reject' && o.id === 'reasoning' ? 'fail' : 'pass',
        reason: 'Synthetic validator fixture only, not an actual native execution.',
        refs: ['body'],
      })),
    };
    const observations: any[] = [
      { type: 'thread.started', sessionId: c.id },
      { type: 'turn.started' },
      { type: 'item.completed', itemType: 'agent_message', text: JSON.stringify(judgment) },
      { type: 'turn.completed' },
    ];
    const prompt = semanticReviewPrompt(bundle);
    observations.splice(1, 0, {
      type: 'native.evidence_staged',
      sessionId: c.id,
      characters: [...prompt].length,
      digest: reviewDigest(prompt),
    });
    const event = {
      preparedRef: 'review:1',
      bundleDigest: reviewDigest(bundle),
      attempt: 1,
      invocation: {
        id: c.id,
        sessionId: c.id,
        host: 'codex',
        hostVersion: 'codex-cli 0.163.0',
        model: 'fixture-model',
        completed: true,
        exitStatus: 0,
        timedOut: false,
        transcriptDigest: reviewDigest(observations),
      },
      binaryDigest: 'a'.repeat(64),
      profile: 'codex-app-server-held-text-v2',
      modelSource: 'requested',
      startedAt: '2026-10-10T00:59:00Z',
      observations,
      judgment,
      problems: semanticJudgmentProblems(bundle, judgment),
    };
    const draft = { id: 'draft', runId: 'run', stepRunId: 'step', trustState: 'draft', body: bundle.body };
    records.push({
      deliverableBefore: structuredClone(draft),
      deliverableAfter: structuredClone(draft),
      caseId: c.id,
      surfaceDigest: digest,
      prepared: { ref: 'review:1', digest: reviewDigest(bundle), bundle },
      event,
      completedAt: '2026-10-10T00:59:30Z',
      filesUnchanged: true,
      canaryAbsent: true,
      finalState: c.expected === 'pass' ? 'succeeded' : 'running',
      stepState: c.expected === 'pass' ? 'succeeded' : 'leased',
    });
  }
  const manifest: any = {
    format: 'construct-experimental-alpha-v1',
    tier: 'experimental-alpha',
    version: '3.0.0-alpha.27',
    surfaceDigest: digest,
    broadQualification: false,
    reviewerModel: 'fixture-model',
    limitations: Object.fromEntries(
      DISCLOSURES.map((k: string) => [k, 'This limited synthetic fixture establishes no general capability or qualification.']),
    ),
    cases: [],
    freshUserObservations: [
      { path: 'fresh-a', sha256: sha256('failed'), summary: 'A real fresh-user outcome failed; this remains a limitation, not a pass.' },
      { path: 'fresh-b', sha256: sha256('failed'), summary: 'A second fresh-user outcome remained incomplete; this is not qualified.' },
    ],
  };
  files.set('fresh-a', Buffer.from('failed'));
  files.set('fresh-b', Buffer.from('failed'));
  const freeze = () => {
    manifest.cases = records.map((r) => {
      const b = Buffer.from(JSON.stringify(r));
      files.set(r.caseId, b);
      return { id: r.caseId, path: r.caseId, sha256: sha256(b) };
    });
  };
  freeze();
  const check = () =>
    checkExperimental({
      manifest,
      version: '3.0.0-alpha.27',
      digest,
      now,
      read: (p: string) => {
        const b = files.get(p);
        if (!b) throw Error('missing file');
        return b;
      },
    });
  return { records, manifest, files, freeze, check };
}
test('experimental records verify bounded controls without claiming qualification', () => {
  assert.equal(fixture().check().ok, true);
});
test('a release without native review passes only when it says so, why, and under which decision, with no review cases', () => {
  const unreviewed = () => {
    const f = fixture();
    f.manifest.cases = [];
    f.manifest.nativeReview = { ...WITHOUT_NATIVE_REVIEW };
    return f;
  };
  const ok = unreviewed().check();
  assert.equal(ok.ok, true, ok.problems.join('; '));
  assert.equal(ok.nativeReview, 'unavailable');
  const silent = fixture();
  silent.manifest.cases = [];
  assert.match(silent.check().problems.join('; '), /exactly three distinct bounded controls/);
  const short = unreviewed();
  short.manifest.nativeReview.reason = 'Codex is off.';
  assert.match(short.check().problems.join('; '), /substantive reason/);
  const undecided = unreviewed();
  undecided.manifest.nativeReview.decision = 'Gerald said so';
  assert.match(undecided.check().problems.join('; '), /recorded decision/);
  const mixed = unreviewed();
  mixed.freeze();
  assert.match(mixed.check().problems.join('; '), /carries no review cases/);
  const other = unreviewed();
  other.manifest.nativeReview.status = 'waived';
  assert.match(other.check().problems.join('; '), /only record that no native review was available/);
});
test('versioned packet canonicalization binds its contract and refuses unsupported formats', () => {
  const make = () => fixture();
  assert.equal(make().check().ok, true);
  const unknown = make();
  unknown.records[0].prepared.bundle.canonicalization = 'future';
  unknown.records[0].prepared.digest = reviewDigest(unknown.records[0].prepared.bundle);
  unknown.records[0].event.bundleDigest = unknown.records[0].prepared.digest;
  unknown.freeze();
  assert.equal(unknown.check().ok, false);
  const stale = make();
  stale.records[0].prepared.bundle.contract.request.input.request = 'changed';
  stale.records[0].prepared.digest = reviewDigest(stale.records[0].prepared.bundle);
  stale.records[0].event.bundleDigest = stale.records[0].prepared.digest;
  stale.freeze();
  assert.equal(stale.check().ok, false);
});
test('the app-server profile requires exact staged prompt identity and ordered public observations', () => {
  const make = () => fixture();
  assert.equal(make().check().ok, true);
  for (const [field, value] of [
    ['hostVersion', 'codex-cli 0.145.0'],
    ['profile', 'codex-held-text-v1'],
  ]) {
    const old = make();
    if (field === 'hostVersion') old.records[0].event.invocation.hostVersion = value;
    else old.records[0].event.profile = value;
    old.freeze();
    assert.match(old.check().problems.join(), /native invocation incomplete or unsupported/, field);
  }
  for (const field of ['sessionId', 'characters', 'digest']) {
    const f = make();
    (f.records[0].event.observations[1] as any)[field] = 'wrong';
    f.records[0].event.invocation.transcriptDigest = reviewDigest(f.records[0].event.observations);
    f.freeze();
    assert.equal(f.check().ok, false, field);
  }
  const missing = make();
  missing.records[0].event.observations.splice(1, 1);
  missing.records[0].event.invocation.transcriptDigest = reviewDigest(missing.records[0].event.observations);
  missing.freeze();
  assert.equal(missing.check().ok, false);
});
test('experimental alpha cannot replace a stable or unknown tier', async () => {
  const f = fixture();
  assert.equal(checkExperimental({ manifest: f.manifest, version: '3.0.0', digest, now, read: (p: string) => f.files.get(p) }).ok, false);
  assert.equal((await checkRelease({ tier: 'unqualified' })).ok, false);
});
test('missing, stale, malformed or reused native evidence is rejected', () => {
  const mutations: ((f: ReturnType<typeof fixture>) => void)[] = [
    (f) => {
      f.manifest.surfaceDigest = 'old';
    },
    (f) => {
      f.manifest.broadQualification = true;
    },
    (f) => {
      f.manifest.reviewerModel = 'another-model';
    },
    (f) => {
      delete f.manifest.reviewerModel;
    },
    (f) => {
      delete f.manifest.limitations.executor;
    },
    (f) => {
      f.manifest.cases = [];
    },
    (f) => {
      f.manifest.cases = {};
    },
    (f) => {
      f.manifest.freshUserObservations = [];
    },
    (f) => {
      f.manifest.freshUserObservations = {};
    },
    (f) => {
      f.records[0].event.invocation.completed = false;
      f.freeze();
    },
    (f) => {
      f.records[0].event.invocation.timedOut = true;
      f.freeze();
    },
    (f) => {
      f.records[0].event.invocation.exitStatus = 1;
      f.freeze();
    },
    (f) => {
      f.records[0].event.invocation.sessionId = 'incorrect';
      f.freeze();
    },
    (f) => {
      f.records[0].event.binaryDigest = 'b'.repeat(64);
      f.freeze();
    },
    (f) => {
      f.records[0].completedAt = '2026-10-01T00:59:30Z';
      f.freeze();
    },
    (f) => {
      f.records[0].completedAt = 'invalid';
      f.freeze();
    },
    (f) => {
      f.records[0].prepared.bundle.body.summary = 'replaced';
      f.freeze();
    },
    (f) => {
      f.records[0].event.judgment.checks[0].reason = 'changed';
      f.freeze();
    },
    (f) => {
      f.records[0].event.problems.push('configuration changed');
      f.freeze();
    },
    (f) => {
      f.records[1].finalState = 'succeeded';
      f.freeze();
    },
    (f) => {
      f.records[2].canaryAbsent = false;
      f.freeze();
    },
    (f) => {
      f.records[2].filesUnchanged = false;
      f.freeze();
    },
    (f) => {
      f.records[0].event.observations.push({ type: 'item.completed', itemType: 'command_execution' });
      f.records[0].event.invocation.transcriptDigest = reviewDigest(f.records[0].event.observations);
      f.freeze();
    },
    (f) => {
      delete f.records[1].deliverableAfter;
      f.freeze();
    },
    (f) => {
      f.records[1].deliverableAfter.body = { summary: 'lost' };
      f.freeze();
    },
    (f) => {
      f.records[1].deliverableAfter.trustState = 'validated';
      f.freeze();
    },
    (f) => {
      f.records[1].deliverableAfter.id = 'other';
      f.freeze();
    },
    (f) => {
      f.files.set('correct', Buffer.from('{}'));
    },
    (f) => {
      f.files.delete('fresh-a');
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const f = fixture();
    mutate(f);
    assert.equal(f.check().ok, false, `mutation ${index}`);
  }
});
test('evidence paths cannot escape the repository through traversal or symlinks', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-gate-')),
    outside = mkdtempSync(join(tmpdir(), 'release-out-'));
  try {
    writeFileSync(join(root, 'good'), 'ok');
    writeFileSync(join(outside, 'secret'), 'outside');
    symlinkSync(join(outside, 'secret'), join(root, 'link'));
    assert.equal(repositoryFile(root, 'good').toString(), 'ok');
    for (const p of ['../secret', '/secret', 'a/../../secret', 'link']) assert.throws(() => repositoryFile(root, p));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
test('release CI retains code gates and selects experimental evidence explicitly', () => {
  const y = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');
  for (const cmd of [
    'npm ci',
    'npm run lint',
    'npm run typecheck',
    'npm test',
    'npm run smoke',
    'npm run release:check -- --tier=experimental-alpha',
    'npm publish --provenance --tag alpha',
  ])
    assert.ok(y.includes(cmd), cmd);
  assert.ok(y.indexOf('release:check') < y.indexOf('npm publish --provenance'));
});

test('a new native attempt makes previous success ineligible until completion', () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-attempt-'));
  try {
    const f = fixture(),
      path = join(dir, 'manifest.json');
    writeFileSync(path, JSON.stringify(f.manifest));
    assert.equal(f.check().ok, true);
    beginExperimentalAttempt(path, join(dir, 'next-attempt'));
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'next-attempt/previous-manifest.json'), 'utf8')), f.manifest);
    const pending = JSON.parse(readFileSync(path, 'utf8'));
    const result = checkExperimental({ manifest: pending, version: '3.0.0-alpha.27', digest, now, read: (p: string) => f.files.get(p) });
    assert.equal(result.ok, false, 'a crash or failed attempt cannot reuse old success');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
