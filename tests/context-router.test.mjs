/**
 * tests/context-router.test.mjs — role-aware context routing contract.
 *
 * Pins the deterministic selection logic: per-role prefers/avoids,
 * maxArtifacts cap, token budget, reason strings on every kept and
 * omitted artifact, role coverage across the persona registry.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildContextPacket, ROLE_POLICIES, normalizeContextCandidates, filterEntitledSkillCandidates } from '../lib/context-router.mjs';

function artifact(overrides = {}) {
  return {
    path: 'docs/example.md',
    title: 'Example',
    kind: 'prd',
    summary: 'A short summary describing the artifact.',
    score: 0.6,
    ...overrides,
  };
}

describe('buildContextPacket', () => {
  it('returns an empty-but-shaped packet when no candidates are provided', () => {
    const r = buildContextPacket({ request: 'fix login', role: 'engineer' });
    assert.equal(r.role, 'engineer');
    assert.deepEqual(r.contextPacket.relatedArtifacts, []);
    assert.deepEqual(r.contextPacket.relevantFiles, []);
    assert.deepEqual(r.omitted, []);
    assert.match(r.contextPacket.taskSummary, /fix login/);
  });

  it('keeps preferred artifact kinds and omits avoid-listed kinds with a reason', () => {
    const r = buildContextPacket({
      request: 'product framing for notifications',
      role: 'product-manager',
      candidates: [
        artifact({ path: 'docs/specs/prd/notifications.md', kind: 'prd', title: 'PRD: notifications' }),
        artifact({ path: 'docs/operations/runbooks/oncall.md', kind: 'runbook', title: 'Runbook: oncall' }),
        artifact({ path: 'docs/notes/research/competitor.md', kind: 'research-brief', title: 'Competitor scan' }),
      ],
    });
    const kinds = r.contextPacket.relatedArtifacts.map((a) => a.kind);
    assert.ok(kinds.includes('prd'));
    assert.ok(kinds.includes('research-brief'));
    assert.ok(!kinds.includes('runbook'));
    const dropped = r.omitted.find((o) => o.artifact.kind === 'runbook');
    assert.match(dropped.reason, /avoid list/);
  });

  it('attaches a reason to every kept artifact', () => {
    const r = buildContextPacket({
      request: 'fix login',
      role: 'engineer',
      candidates: [
        artifact({ path: 'lib/auth.mjs', kind: 'target-file' }),
        artifact({ path: 'tests/auth.test.mjs', kind: 'test' }),
      ],
    });
    for (const a of r.contextPacket.relatedArtifacts) {
      assert.ok(a.reason && a.reason.length > 5, `expected reason for ${a.path}`);
    }
  });

  it('orders kept artifacts by role preference, not raw retrieval score', () => {
    const r = buildContextPacket({
      request: 'fix login',
      role: 'engineer',
      candidates: [
        artifact({ path: 'docs/prd.md', kind: 'prd', score: 0.95 }),
        artifact({ path: 'lib/auth.mjs', kind: 'target-file', score: 0.40 }),
      ],
    });
    // engineer prefers target-file > prd, so target-file should rank higher despite lower score
    assert.equal(r.contextPacket.relatedArtifacts[0].kind, 'target-file');
  });

  it('respects the role.maxArtifacts cap and reports the rest as omitted', () => {
    const candidates = Array.from({ length: 20 }, (_, i) =>
      artifact({ path: `lib/file${i}.mjs`, kind: 'target-file', score: 0.5 }),
    );
    const r = buildContextPacket({ request: 'refactor', role: 'engineer', candidates });
    assert.ok(r.contextPacket.relatedArtifacts.length <= ROLE_POLICIES.engineer.maxArtifacts);
    const overflow = r.omitted.find((o) => /maxArtifacts cap/.test(o.reason));
    assert.ok(overflow, 'maxArtifacts overflow is reported');
  });

  it('respects budget.maxTokens', () => {
    const bigSummary = 'x'.repeat(2000);
    const candidates = Array.from({ length: 5 }, (_, i) =>
      artifact({ path: `lib/file${i}.mjs`, kind: 'target-file', summary: bigSummary }),
    );
    const r = buildContextPacket({ request: 'refactor', role: 'engineer', candidates, budget: { maxTokens: 200 } });
    assert.ok(r.tokensUsed <= 200, `tokensUsed=${r.tokensUsed} exceeds budget`);
    assert.ok(r.omitted.some((o) => /token budget/.test(o.reason)));
  });

  it('surfaces target-file and test artifacts in relevantFiles', () => {
    const r = buildContextPacket({
      request: 'fix login',
      role: 'debugger',
      candidates: [
        artifact({ path: 'lib/auth.mjs', kind: 'target-file' }),
        artifact({ path: 'tests/auth.test.mjs', kind: 'test' }),
        artifact({ path: 'docs/decisions/adr/0007-auth.md', kind: 'adr' }),
      ],
    });
    const paths = r.contextPacket.relevantFiles.map((f) => f.path);
    assert.ok(paths.includes('lib/auth.mjs'));
    assert.ok(paths.includes('tests/auth.test.mjs'));
    assert.ok(!paths.includes('docs/decisions/adr/0007-auth.md'));
  });

  it('passes through constraints, priorObservations, and verificationRequirements', () => {
    const r = buildContextPacket({
      role: 'engineer',
      constraints: ['no new dependencies'],
      priorObservations: [{ id: 'obs-1', summary: 'auth was flaky last week' }],
      verificationRequirements: ['npm test green', 'lint:comments clean'],
    });
    assert.deepEqual(r.contextPacket.constraints, ['no new dependencies']);
    assert.equal(r.contextPacket.priorObservations.length, 1);
    assert.equal(r.contextPacket.verificationRequirements.length, 2);
  });

  it('falls back to a sensible default policy for unknown roles', () => {
    const r = buildContextPacket({
      request: 'unknown role test',
      role: 'imaginary-persona',
      candidates: [
        artifact({ path: 'docs/decisions/adr/0001.md', kind: 'adr' }),
      ],
    });
    assert.equal(r.contextPacket.relatedArtifacts.length, 1);
  });

  it('renders triage info into the task summary when present', () => {
    const r = buildContextPacket({
      request: 'investigate latency',
      triage: { intakeType: 'incident', rdStage: 'operations', primaryOwner: 'sre', recommendedAction: 'create-runbook' },
      role: 'sre',
    });
    assert.match(r.contextPacket.taskSummary, /incident/);
    assert.match(r.contextPacket.taskSummary, /sre/);
  });
});

describe('normalizeContextCandidates', () => {
  it('returns [] for non-array input', () => {
    assert.deepEqual(normalizeContextCandidates(null), []);
    assert.deepEqual(normalizeContextCandidates('nope'), []);
    assert.deepEqual(normalizeContextCandidates(undefined), []);
  });

  it('coerces fields to strings and drops content-less entries', () => {
    const out = normalizeContextCandidates([
      { path: 123, title: null, kind: 'prd', summary: 'ok' },
      { kind: 'prd' },
      null,
      42,
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].path, '123');
    assert.equal(out[0].kind, 'prd');
  });

  it('caps count, path, title, and summary length', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ path: `p${i}`, kind: 'target-file', summary: 'x'.repeat(5000), title: 'y'.repeat(5000) }));
    const out = normalizeContextCandidates(many);
    assert.equal(out.length, 40);
    assert.ok(out[0].summary.length <= 600);
    assert.ok(out[0].title.length <= 200);
  });

  it('defaults skillId to path for kind "skill" and preserves an explicit skillId', () => {
    const out = normalizeContextCandidates([
      { path: 'strategy/prioritization-methods', kind: 'skill', summary: 's' },
      { path: 'x', kind: 'skill', skillId: 'development/testing', summary: 's' },
      { path: 'lib/a.mjs', kind: 'target-file', summary: 's' },
    ]);
    assert.equal(out[0].skillId, 'strategy/prioritization-methods');
    assert.equal(out[1].skillId, 'development/testing');
    assert.equal(out[2].skillId, undefined);
  });

  it('keeps a finite score and drops a non-finite one', () => {
    const out = normalizeContextCandidates([
      { path: 'a', kind: 'prd', summary: 's', score: 0.7 },
      { path: 'b', kind: 'prd', summary: 's', score: Number.NaN },
    ]);
    assert.equal(out[0].score, 0.7);
    assert.equal(out[1].score, undefined);
  });
});

describe('filterEntitledSkillCandidates', () => {
  const artifacts = [
    { path: 'lib/a.mjs', kind: 'target-file', summary: 's' },
    { path: 'strategy/prioritization-methods', kind: 'skill', skillId: 'strategy/prioritization-methods', summary: 's' },
    { path: 'operating/fleet-health-routing', kind: 'skill', skillId: 'operating/fleet-health-routing', summary: 's' },
  ];

  it('drops skill candidates the role is not entitled to and keeps non-skill artifacts', () => {
    const entitled = new Set(['strategy/prioritization-methods']);
    const { kept, denied } = filterEntitledSkillCandidates(artifacts, entitled);
    const keptIds = kept.map((c) => c.path);
    assert.ok(keptIds.includes('lib/a.mjs'));
    assert.ok(keptIds.includes('strategy/prioritization-methods'));
    assert.ok(!keptIds.includes('operating/fleet-health-routing'));
    assert.equal(denied.length, 1);
    assert.match(denied[0].reason, /entitlement list/);
  });

  it('treats a null or empty entitlement set as unrestricted', () => {
    assert.equal(filterEntitledSkillCandidates(artifacts, null).kept.length, 3);
    assert.equal(filterEntitledSkillCandidates(artifacts, new Set()).kept.length, 3);
  });

  it('gates a kind:"skill" candidate by path when no explicit skillId is set', () => {
    const cands = [{ path: 'security/threat-modeling', kind: 'skill', summary: 's' }];
    const { kept, denied } = filterEntitledSkillCandidates(cands, new Set(['strategy/prioritization-methods']));
    assert.equal(kept.length, 0);
    assert.equal(denied.length, 1);
  });
});

describe('ROLE_POLICIES coverage', () => {
  it('covers every persona name listed as a primaryOwner in the triage table', async () => {
    const { classifyRdIntake } = await import('../lib/intake/classify.mjs');
    const samples = [
      { text: 'stack trace bug', expect: 'debugger' },
      { text: 'customer feedback pain point', expect: 'product-manager' },
      { text: 'competitor pricing market scan', expect: 'business-strategist' },
      { text: 'hypothesis experiment spike', expect: 'rd-lead' },
      { text: 'eval recall@5 hallucination', expect: 'evaluator' },
      { text: 'ADR architecture tradeoff', expect: 'architect' },
      { text: 'incident outage latency spike', expect: 'sre' },
      { text: 'release changelog version', expect: 'release-manager' },
      { text: 'CVE security vulnerability', expect: 'security' },
      { text: 'GDPR compliance audit', expect: 'legal-compliance' },
      { text: 'runbook cron capacity plan', expect: 'operations' },
    ];
    for (const s of samples) {
      const r = classifyRdIntake({ sourcePath: '/tmp/x.md', extractedText: s.text });
      assert.equal(r.primaryOwner, s.expect);
      assert.ok(ROLE_POLICIES[r.primaryOwner], `ROLE_POLICIES missing entry for ${r.primaryOwner}`);
    }
  });
});
