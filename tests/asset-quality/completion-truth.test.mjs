/**
 * tests/asset-quality/completion-truth.test.mjs — Guards the artifact completion-state truth model.
 *
 * The asset-quality program (construct-cuxq) adds completion rungs above "exported"
 * (visually-rendered, visual-reviewed, accessibility-reviewed, approved). This test locks the
 * current no-forgery invariant before those rungs land: the workflow must never report a
 * review/visual/approval state that it has no evidence for. Pending cases name the bead
 * (construct-cuxq.9.2 / construct-cuxq.1.2) that will enforce the evidence-gated ladder, so the
 * gap stays visible rather than silently passing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runArtifactWorkflow } from '../../lib/artifact-workflow.mjs';
import { COMPLETION_STATES, completionRank } from '../../lib/artifact-completion-states.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// States that must never be reachable from planning or skipped specialist work alone — each
// requires stored evidence the local command cannot produce. Derived from the canonical ladder
// (screenshot-captured and above) so this guard tracks the single source, not a copy of it.

const FORGED_STATES = COMPLETION_STATES.slice(completionRank('screenshot-captured'));

test('status is never a forged review/visual/approval state when only specialist work is planned', () => {
  for (const approvalMode of [undefined, 'allow-durable-write']) {
    const report = runArtifactWorkflow(
      { input: 'Review and rewrite this ADR as a customer PDF.', approvalMode },
      { rootDir: REPO, cwd: REPO },
    );
    assert.ok(!FORGED_STATES.includes(report.status), `status "${report.status}" is a forged rung`);
    assert.equal(report.reviewed ?? false, false);
    assert.equal(report.approved ?? false, false);
  }
});

test('exported/completed status is evidence-gated: no produced file means no completed-local-steps', () => {
  const report = runArtifactWorkflow(
    { input: 'Review and rewrite this runbook as HTML.', approvalMode: 'allow-durable-write' },
    { rootDir: REPO, cwd: REPO },
  );
  assert.equal(report.producedFiles.length, 0);
  assert.equal(report.executedSteps.length, 0);
  assert.notEqual(report.status, 'completed-local-steps');
});

test('visually-rendered requires a captured renderer exit code + log', { skip: 'enforced by construct-cuxq.9.2' }, () => {});

test('visual-reviewed requires a stored rendered image + rubric report', { skip: 'enforced by construct-cuxq.9.2' }, () => {});

test('accessibility-reviewed requires a per-format a11y report', { skip: 'enforced by construct-cuxq.8.1' }, () => {});

test('completion-state enum is shared across manifest, workflow, gate, and CLI', { skip: 'enforced by construct-cuxq.1.2' }, () => {});
