/**
 * tests/intake-classify.test.mjs — Unit tests for lib/intake/classify.mjs.
 *
 * Covers the R&D triage classification: enum exposure, the 10+ canonical
 * signal classes (bug, user-signal, research, experiment, eval-finding,
 * architecture, incident, launch-asset, security, ops, requirement,
 * legal-compliance), tie-breaking by row order, the unknown fallback,
 * and the formatTriageLine helper feeding the session-start surface.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  INTAKE_TYPES,
  RD_STAGES,
  RECOMMENDED_ACTIONS,
  classifyRdIntake,
  formatTriageLine,
} from '../lib/intake/classify.mjs';

describe('classifyRdIntake', () => {
  it('exposes the canonical enums', () => {
    assert.ok(INTAKE_TYPES.includes('bug'));
    assert.ok(INTAKE_TYPES.includes('user-signal'));
    assert.ok(INTAKE_TYPES.includes('unknown'));
    assert.ok(RD_STAGES.includes('implementation'));
    assert.ok(RD_STAGES.includes('signal'));
    assert.ok(RECOMMENDED_ACTIONS.includes('diagnose'));
    assert.ok(RECOMMENDED_ACTIONS.includes('draft-prd'));
  });

  it('classifies a stack-trace bug report', () => {
    const r = classifyRdIntake({
      sourcePath: '.cx/inbox/login-error.md',
      extractedText: 'Users hit a stack trace on the login redirect. Reproduce: open /auth, click sign-in. Stack trace points to authMiddleware.',
    });
    assert.equal(r.intakeType, 'bug');
    assert.equal(r.rdStage, 'implementation');
    assert.equal(r.primaryOwner, 'debugger');
    assert.deepEqual(r.recommendedChain, ['debugger', 'engineer', 'qa', 'reviewer']);
    assert.equal(r.recommendedAction, 'diagnose');
  });

  it('classifies a customer-feedback user signal', () => {
    const r = classifyRdIntake({
      sourcePath: '.cx/inbox/q3-feedback.md',
      extractedText: 'Customer feedback shows the onboarding pain point: NPS dropped after the recent UX change. User says it is frustrated by the flow.',
    });
    assert.equal(r.intakeType, 'user-signal');
    assert.equal(r.primaryOwner, 'product-manager');
    assert.equal(r.rdStage, 'signal');
  });

  it('classifies competitor / market research', () => {
    const r = classifyRdIntake({
      sourcePath: '.cx/inbox/competitor-pricing.md',
      extractedText: 'Industry pricing scan: our nearest competitor moved to per-seat market positioning.',
    });
    assert.equal(r.intakeType, 'research');
    assert.equal(r.primaryOwner, 'business-strategist');
    assert.equal(r.rdStage, 'research');
  });

  it('classifies a hypothesis / experiment', () => {
    const r = classifyRdIntake({
      sourcePath: '.cx/inbox/cache-spike.md',
      extractedText: 'Hypothesis: prompt caching the system prompt cuts dispatch latency by 30 percent. Plan a 1-week spike / prototype with a falsifiable success metric.',
    });
    assert.equal(r.intakeType, 'experiment');
    assert.equal(r.primaryOwner, 'rd-lead');
    assert.equal(r.recommendedAction, 'create-experiment');
  });

  it('classifies an eval-finding (hallucination, judge)', () => {
    const r = classifyRdIntake({
      sourcePath: '.cx/inbox/retrieval-eval-report.md',
      extractedText: 'Recall@5 dropped on the new dataset; trace shows hallucination on three of the failure cases. Judge rubric needs an update.',
    });
    assert.equal(r.intakeType, 'eval-finding');
    assert.equal(r.primaryOwner, 'evaluator');
    assert.equal(r.recommendedAction, 'evaluate');
  });

  it('classifies an architecture / ADR signal', () => {
    const r = classifyRdIntake({
      sourcePath: '.cx/inbox/queue-tradeoff.md',
      extractedText: 'ADR draft: weigh the tradeoff between Postgres queue and a dedicated broker. Interface contract impact on the worker pool.',
    });
    assert.equal(r.intakeType, 'architecture');
    assert.equal(r.primaryOwner, 'architect');
    assert.equal(r.rdStage, 'design');
    assert.deepEqual(r.recommendedChain, ['architect', 'devil-advocate', 'engineer']);
  });

  it('classifies an incident', () => {
    const r = classifyRdIntake({
      sourcePath: '.cx/inbox/2026-05-10-outage.md',
      extractedText: 'P0 incident: dashboard outage, 5xx for 12 minutes. Latency spike preceding the failure. PagerDuty fired.',
    });
    assert.equal(r.intakeType, 'incident');
    assert.equal(r.primaryOwner, 'sre');
    assert.equal(r.risk, 'high');
    assert.equal(r.requiresApproval, true);
  });

  it('classifies a launch-asset / release item', () => {
    const r = classifyRdIntake({
      sourcePath: '.cx/inbox/v0.2-release.md',
      extractedText: 'Cut a release for v0.2: changelog draft attached, version bump in package.json, rc1 candidate ready to ship.',
    });
    assert.equal(r.intakeType, 'launch-asset');
    assert.equal(r.primaryOwner, 'release-manager');
    assert.equal(r.recommendedAction, 'release-review');
  });

  it('classifies a security finding', () => {
    const r = classifyRdIntake({
      sourcePath: '.cx/inbox/cve-2026-1234.md',
      extractedText: 'CVE-2026-1234: SQLi in the search endpoint. Vulnerability disclosure deadline next week. Need an exploit mitigation plan.',
    });
    assert.equal(r.intakeType, 'security');
    assert.equal(r.primaryOwner, 'security');
    assert.equal(r.risk, 'high');
    assert.equal(r.requiresApproval, true);
  });

  it('classifies an ops / runbook task', () => {
    const r = classifyRdIntake({
      sourcePath: '.cx/inbox/backup-job.md',
      extractedText: 'Set up a cron for the nightly backup; capacity plan for the next quarter is attached. Dependency upgrade ticket follows.',
    });
    assert.equal(r.intakeType, 'ops');
    assert.equal(r.primaryOwner, 'operations');
  });

  it('classifies a requirement / PRD signal', () => {
    const r = classifyRdIntake({
      sourcePath: '.cx/inbox/notifications-prd.md',
      extractedText: 'Feature request: notifications. Acceptance criteria, success metric, and a list of use cases are below.',
    });
    assert.equal(r.intakeType, 'requirement');
    assert.equal(r.primaryOwner, 'product-manager');
    assert.equal(r.recommendedAction, 'draft-prd');
  });

  it('classifies a legal-compliance signal', () => {
    const r = classifyRdIntake({
      sourcePath: '.cx/inbox/gdpr-review.md',
      extractedText: 'GDPR compliance audit found a PII retention concern in the events table. DPA needs review.',
    });
    assert.equal(r.intakeType, 'legal-compliance');
    assert.equal(r.primaryOwner, 'legal-compliance');
    assert.equal(r.requiresApproval, true);
  });

  it('falls back to unknown when no keywords match', () => {
    const r = classifyRdIntake({
      sourcePath: '.cx/inbox/random-note.md',
      extractedText: 'Today the weather is rainy and the coffee was good.',
    });
    assert.equal(r.intakeType, 'unknown');
    assert.equal(r.rdStage, 'unknown');
    assert.equal(r.primaryOwner, 'orchestrator');
    assert.equal(r.recommendedAction, 'summarize');
    assert.equal(r.confidence, 0.3);
  });

  it('breaks ties in favor of higher-stakes classes (security beats research)', () => {
    const r = classifyRdIntake({
      sourcePath: '.cx/inbox/competitor-cve.md',
      extractedText: 'Competitor disclosure: their auth bypass exploit is being marketed as a feature. Pricing teardown follows.',
    });
    assert.equal(r.intakeType, 'security');
  });

  it('uses filename slugs when extractedText is empty', () => {
    const r = classifyRdIntake({
      sourcePath: '.cx/inbox/2026-05-incident-postmortem.md',
      extractedText: '',
    });
    assert.equal(r.intakeType, 'incident');
  });

  it('considers related-doc titles in the signal', () => {
    const r = classifyRdIntake({
      sourcePath: '.cx/inbox/note.md',
      extractedText: 'See attached.',
      related: [{ title: 'eval rubric for the retrieval judge', path: 'docs/evals/rubric.md' }],
    });
    assert.equal(r.intakeType, 'eval-finding');
  });
});

describe('formatTriageLine', () => {
  it('renders the canonical session-start triage line', () => {
    const triage = classifyRdIntake({
      sourcePath: '.cx/inbox/login-feedback.md',
      extractedText: 'Stack trace on login redirect, reproduce on /auth.',
    });
    const line = formatTriageLine('.cx/inbox/login-feedback.md', triage);
    assert.equal(line, 'login-feedback.md → bug / implementation · owner: debugger · next: diagnose');
  });

  it('renders an unclassified entry distinctly', () => {
    const line = formatTriageLine('.cx/inbox/random.md', {
      intakeType: 'unknown',
      rdStage: 'unknown',
      primaryOwner: 'orchestrator',
      recommendedAction: 'summarize',
    });
    assert.match(line, /unclassified/);
    assert.match(line, /owner: orchestrator/);
  });
});
