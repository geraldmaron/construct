/**
 * tests/kernel/project/discovery.test.ts — the project's own files become
 * proposals with provenance; three questions; nothing confirms itself.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gatherProjectMaterial, MAX_MATERIAL_FILE_BYTES } from '../../../src/hosts/repo/material.ts';
import { draftFromMaterial, ONBOARDING_QUESTIONS } from '../../../src/kernel/project/discovery.ts';
import {
  applyDiscoveryDraft, applyOnboardingAnswers, acceptProposal, onboardingStatus, composeConstitution,
} from '../../../src/kernel/project/onboarding.ts';
import { emptyConstitution, validateConstitution, constitutionCompleteness } from '../../../src/kernel/project/constitution.ts';
import { initializeProject } from '../../../src/kernel/project/initialize.ts';
import { listStatements } from '../../../src/kernel/state/profile.ts';
import { listRelations } from '../../../src/kernel/state/graph.ts';
import { listOpenDecisions } from '../../../src/kernel/state/decisions.ts';
import { tmpProject, AT } from './support.ts';

function fixtureRepo(root: string): void {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@acme/ledger', description: 'Double-entry ledger for small teams', workspaces: ['packages/*'], scripts: { test: 'node --test', lint: 'eslint .' } }), 'utf8');
  writeFileSync(join(root, 'README.md'), [
    '# Ledger', '', '[![ci](x)](y)', '', 'A ledger that never loses a cent.', 'It runs anywhere Node runs.', '',
    '## Design principles', '', '- Every posting is append-only', '- **Balances are derived**, never stored', '', '## Usage', '', '- not a principle',
  ].join('\n'), 'utf8');
  writeFileSync(join(root, 'AGENTS.md'), [
    '# Agent instructions', '', 'Never commit generated files.', 'Do not edit the ledger schema without a decision record.', 'Run the tests before every commit.',
    '', '## Conventions', '', '- Commit messages state the invariant',
  ].join('\n'), 'utf8');
  mkdirSync(join(root, '.github'), { recursive: true });
  writeFileSync(join(root, '.github', 'CODEOWNERS'), ['# owners', 'packages/core/ @acme/platform', 'docs/ @acme/docs-team @acme/platform', ''].join('\n'), 'utf8');
  writeFileSync(join(root, 'GLOSSARY.md'), ['| Term | Retired | Meaning |', '|---|---|---|', '| posting | entry | One immutable line in the ledger. |', '| balance | — | A sum derived from postings. |'].join('\n'), 'utf8');
  mkdirSync(join(root, 'docs', 'adr'), { recursive: true });
  writeFileSync(join(root, 'docs', 'architecture.md'), ['# Architecture', '', '## Boundaries', '', '- The kernel never touches the network'].join('\n'), 'utf8');
  writeFileSync(join(root, 'docs', 'adr', '0001.md'), '# ADR 1', 'utf8');
  writeFileSync(join(root, 'tsconfig.json'), '{}', 'utf8');
}

test('material is read narrowly, capped, and never through a link', () => {
  const { root, cleanup } = tmpProject();
  try {
    fixtureRepo(root);
    writeFileSync(join(root, 'CONTRIBUTING.md'), 'x'.repeat(MAX_MATERIAL_FILE_BYTES + 10), 'utf8');
    symlinkSync(join(root, 'AGENTS.md'), join(root, 'CLAUDE.md'));
    const m = gatherProjectMaterial(root);
    assert.equal(m.manifest?.name, '@acme/ledger');
    assert.deepEqual(m.manifest?.scripts, ['lint', 'test']);
    assert.equal(m.readme?.path, 'README.md');
    assert.deepEqual(m.agentInstructions.map((f) => f.path), ['AGENTS.md']);
    assert.equal(m.contributing?.truncated, true);
    assert.equal(m.contributing?.text.length, MAX_MATERIAL_FILE_BYTES);
    assert.equal(m.codeowners?.path, '.github/CODEOWNERS');
    assert.deepEqual(m.docFiles, ['docs/adr/0001.md', 'docs/architecture.md']);
    assert.equal(m.hasTypeScript, true);
    assert.deepEqual(gatherProjectMaterial(join(root, 'nowhere')).docFiles, []);
  } finally {
    cleanup();
  }
});

test('the draft carries provenance on every proposal and asks exactly three questions', () => {
  const { root, cleanup } = tmpProject();
  try {
    fixtureRepo(root);
    const draft = draftFromMaterial(gatherProjectMaterial(root));
    const name = draft.profile.find((p) => p.field === 'name')!;
    assert.equal(name.value, 'ledger');
    assert.equal(name.confidence, 0.9);
    assert.equal(name.provenance.path, 'package.json');
    const purpose = draft.profile.find((p) => p.field === 'purpose')!;
    assert.equal(purpose.value, 'Double-entry ledger for small teams');
    const scale = draft.profile.find((p) => p.field === 'scale')!;
    assert.equal(scale.value, 'multi_team');
    assert.ok(scale.confidence <= 0.3);

    const principles = draft.statements.filter((s) => s.kind === 'principle').map((s) => s.text);
    assert.deepEqual(principles, ['Every posting is append-only', 'Balances are derived, never stored', 'Commit messages state the invariant']);
    const constraints = draft.statements.filter((s) => s.kind === 'constraint');
    assert.deepEqual(constraints.map((s) => s.text), ['Never commit generated files.', 'Do not edit the ledger schema without a decision record.']);
    assert.deepEqual(constraints.map((s) => [s.provenance.path, s.provenance.line]), [['AGENTS.md', 3], ['AGENTS.md', 4]]);
    assert.deepEqual(draft.statements.filter((s) => s.kind === 'boundary').map((s) => s.text), ['The kernel never touches the network']);
    assert.deepEqual(draft.statements.filter((s) => s.kind === 'glossary_entry').map((s) => s.term), ['posting', 'balance']);
    assert.deepEqual(draft.ownership.map((o) => [o.pattern, o.owners]), [['packages/core/', ['@acme/platform']], ['docs/', ['@acme/docs-team', '@acme/platform']]]);
    assert.deepEqual(draft.canonicalArtifacts.map((c) => c.role), ['overview', 'agent instructions', 'contribution rules', 'architecture', 'glossary', 'ownership'].filter((r) => r !== 'contribution rules'));
    for (const s of draft.statements) assert.ok(s.provenance.path && s.provenance.excerpt);
    assert.equal(draft.questions.length, 3);
    assert.deepEqual(draft.questions.map((q) => q.id), ['scale', 'primary_outcome', 'protected_constraints']);
    assert.equal(draft.questions, ONBOARDING_QUESTIONS);
    assert.ok(draft.unknowns.includes('primary outcome'));
    assert.ok(draft.deferredQuestions.length >= 1);
  } finally {
    cleanup();
  }
});

test('an empty repository yields no proposals, the same three questions, and named unknowns', () => {
  const { root, cleanup } = tmpProject();
  try {
    const draft = draftFromMaterial(gatherProjectMaterial(root));
    assert.deepEqual(draft.profile, []);
    assert.deepEqual(draft.statements, []);
    assert.equal(draft.questions.length, 3);
    assert.ok(draft.unknowns.includes('purpose'));
    assert.ok(draft.unknowns.includes('ownership and decision rights'));
  } finally {
    cleanup();
  }
});

test('applying a draft proposes; only answers and acceptances confirm; the file holds confirmed material only', () => {
  const { root, cleanup } = tmpProject();
  try {
    fixtureRepo(root);
    const init = initializeProject({ root, projectId: 'p', name: 'placeholder', at: AT });
    const store = init.store;
    try {
      let n = 0;
      const nextId = (p: string) => `${p}-${String(++n)}`;
      const draft = draftFromMaterial(gatherProjectMaterial(root));
      const applied = applyDiscoveryDraft(store, { draft, at: AT, nextId });
      assert.equal(applied.profile.onboardingState, 'drafted');
      assert.equal(applied.profile.name, 'placeholder'); // an existing value is kept
      assert.equal(applied.profile.purpose, 'Double-entry ledger for small teams');
      assert.equal(applied.profile.scale, null);
      assert.equal(applied.questions.length, 3);
      assert.ok(applied.proposedStatements.every((s) => s.status === 'proposed'));
      const owned = listRelations(store, { kind: 'owned_by' });
      assert.equal(owned.length, 3);
      assert.ok(owned.every((r) => r.status === 'proposed' && r.basis === 'observed'));

      // A second apply adds nothing and re-raises nothing.
      const again = applyDiscoveryDraft(store, { draft, at: AT, nextId });
      assert.equal(again.proposedStatements.length, 0);
      assert.equal(listOpenDecisions(store).length, 3);

      let status = onboardingStatus(store);
      assert.deepEqual(status.missing, ['scale', 'primaryOutcome']);
      assert.equal(status.openQuestions.length, 3);

      // Proposed material stays out of the constitution file.
      const before = composeConstitution(store, emptyConstitution());
      assert.deepEqual(before.principles, []);
      assert.deepEqual(before.constraints, []);
      assert.ok(before.unknowns.includes('primary outcome'));
      assert.equal(constitutionCompleteness(before).complete, false);

      const answered = applyOnboardingAnswers(store, {
        answers: { scale: 'team', primaryOutcome: 'ship v1 to the first paying team', protectedConstraints: ['Never change posting semantics', ' '] },
        by: 'gerald', at: AT, nextId,
      });
      assert.equal(answered.profile.onboardingState, 'confirmed');
      assert.deepEqual(answered.missing, []);
      assert.equal(answered.confirmed.length, 1);
      assert.equal(listOpenDecisions(store).length, 0);
      status = onboardingStatus(store);
      assert.equal(status.state, 'confirmed');
      assert.ok(status.proposalsAwaitingReview > 0);

      const principle = listStatements(store, { kind: 'principle', status: 'proposed' })[0]!;
      acceptProposal(store, principle.id, AT);
      const c = composeConstitution(store, emptyConstitution());
      assert.equal(c.scale, 'team');
      assert.equal(c.primaryOutcome, 'ship v1 to the first paying team');
      assert.deepEqual(c.principles, [principle.text]);
      assert.deepEqual(c.constraints, ['Never change posting semantics']);
      assert.deepEqual(c.glossary, []);
      assert.equal(constitutionCompleteness(validateConstitution(c, 'constitution.json')).complete, true);
      assert.throws(() => applyOnboardingAnswers(store, { answers: { scale: 'huge' as never }, by: 'g', at: AT, nextId }), /scale must be one of/);
    } finally {
      store.close();
    }
  } finally {
    cleanup();
  }
});

test('noninteractive answers with nothing supplied leave onboarding incomplete and named', () => {
  const { root, cleanup } = tmpProject();
  try {
    const init = initializeProject({ root, projectId: 'p', name: 'bare', at: AT });
    try {
      let n = 0;
      const nextId = (p: string) => `${p}-${String(++n)}`;
      applyDiscoveryDraft(init.store, { draft: draftFromMaterial(gatherProjectMaterial(root)), at: AT, nextId });
      const result = applyOnboardingAnswers(init.store, { answers: {}, by: 'ci', at: AT, nextId });
      assert.equal(result.profile.onboardingState, 'drafted');
      assert.deepEqual(result.missing, ['purpose', 'scale', 'primaryOutcome']);
      assert.equal(onboardingStatus(init.store).openQuestions.length, 3);
      const complete = applyOnboardingAnswers(init.store, { answers: { purpose: 'a tool', scale: 'solo', primaryOutcome: 'learn' }, by: 'ci', at: AT, nextId });
      assert.equal(complete.profile.onboardingState, 'confirmed');
      assert.equal(onboardingStatus(init.store).openQuestions.length, 1); // the constraints question stays open until answered
    } finally {
      init.store.close();
    }
  } finally {
    cleanup();
  }
});
