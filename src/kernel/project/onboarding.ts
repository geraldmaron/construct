/**
 * kernel/project/onboarding.ts — from a discovery draft to a confirmed profile.
 *
 * Applying a draft records proposals as proposed statements and drafted
 * profile fields, and raises the initial questions as clarifications in the
 * inbox. Answers and acceptances are the only way anything becomes confirmed.
 * The committed constitution is composed from confirmed material only.
 */

import type { StateStore } from '../state/open.ts';
import {
  addStatement,
  getProfile,
  listStatements,
  missingProfileFields,
  setStatementStatus,
  upsertProfile,
  PROJECT_SCALES,
  type ProjectProfile,
  type ProjectScale,
  type Statement,
  type StatementKind,
} from '../state/profile.ts';
import { addEntity, addRelation, findEntityByRef, listRelations } from '../state/graph.ts';
import { listOpenDecisions, raiseDecision, resolveDecision, type Decision } from '../state/decisions.ts';
import type { Constitution } from './constitution.ts';
import type { DiscoveryDraft, OnboardingQuestion } from './discovery.ts';

export interface ApplyDraftInput {
  readonly draft: DiscoveryDraft;
  readonly at: string;
  /** Deterministic id source so the kernel mints nothing itself. */
  readonly nextId: (prefix: string) => string;
}

export interface ApplyDraftResult {
  readonly profile: ProjectProfile;
  readonly proposedStatements: readonly Statement[];
  readonly questions: readonly Decision[];
}

/**
 * Record the draft. Profile fields land as drafted values, statements as
 * proposals, ownership as proposed relations, and the questions as open
 * clarifications — one per question, none repeated on a second apply.
 */
export function applyDiscoveryDraft(store: StateStore, input: ApplyDraftInput): ApplyDraftResult {
  const { draft, at, nextId } = input;
  return store.transaction(() => {
    const current = getProfile(store);
    const patch: Record<string, unknown> = {};
    for (const p of draft.profile) {
      if (p.field === 'scale') continue; // scale is the person's answer, never a drafted value
      if (current?.[p.field] == null) patch[p.field] = p.value;
    }
    const profile = upsertProfile(
      store,
      { ...patch, onboardingState: current?.onboardingState === 'confirmed' ? 'confirmed' : 'drafted' },
      at,
    );

    const existing = listStatements(store);
    const proposed: Statement[] = [];
    for (const s of draft.statements) {
      if (existing.some((e) => e.kind === s.kind && e.text === s.text)) continue;
      proposed.push(
        addStatement(store, { id: nextId('st'), kind: s.kind, text: s.text, term: s.term, provenance: 'discovery', at }),
      );
    }
    for (const c of draft.canonicalArtifacts) {
      const text = `${c.path}: ${c.role}`;
      if (existing.some((e) => e.kind === 'canonical_artifact' && e.text === text)) continue;
      proposed.push(addStatement(store, { id: nextId('st'), kind: 'canonical_artifact', text, provenance: 'discovery', at }));
    }
    for (const u of draft.unknowns) {
      if (existing.some((e) => e.kind === 'unknown' && e.text === u)) continue;
      proposed.push(addStatement(store, { id: nextId('st'), kind: 'unknown', text: u, provenance: 'discovery', at }));
    }

    for (const o of draft.ownership) {
      const area =
        findEntityByRef(store, 'code_component', o.pattern) ??
        addEntity(store, { id: nextId('ent'), kind: 'code_component', name: o.pattern, externalRef: o.pattern, at });
      for (const ownerName of o.owners) {
        const owner =
          findEntityByRef(store, 'team', ownerName) ??
          addEntity(store, { id: nextId('ent'), kind: 'team', name: ownerName, externalRef: ownerName, at });
        if (listRelations(store, { kind: 'owned_by', fromId: area.id, toId: owner.id }).length > 0) continue;
        addRelation(store, {
          id: nextId('rel'),
          kind: 'owned_by',
          fromId: area.id,
          toId: owner.id,
          basis: 'observed',
          confidence: o.confidence,
          at,
        });
      }
    }

    const open = listOpenDecisions(store);
    const questions: Decision[] = [];
    for (const q of draft.questions) {
      const already = open.find((d) => d.kind === 'clarification' && isOnboardingSubject(d.subject, q.id));
      if (already) {
        questions.push(already);
        continue;
      }
      questions.push(
        raiseDecision(store, {
          id: nextId('q'),
          kind: 'clarification',
          question: q.question,
          options: q.options,
          subject: { onboarding: q.id },
          at,
        }),
      );
    }
    return { profile, proposedStatements: proposed, questions };
  });
}

function isOnboardingSubject(subject: unknown, id: OnboardingQuestion['id']): boolean {
  return subject !== null && typeof subject === 'object' && (subject as { onboarding?: string }).onboarding === id;
}

export interface OnboardingAnswers {
  readonly scale?: ProjectScale;
  readonly primaryOutcome?: string;
  /** Each becomes one confirmed constraint statement. */
  readonly protectedConstraints?: readonly string[];
  readonly name?: string;
  readonly purpose?: string;
}

/**
 * Apply a person's answers. Each answer confirms its field, resolves its open
 * question, and, when the required fields are all present, marks onboarding
 * confirmed. Works the same for a conversation and for noninteractive flags.
 */
export function applyOnboardingAnswers(
  store: StateStore,
  input: { readonly answers: OnboardingAnswers; readonly by: string; readonly at: string; readonly nextId: (prefix: string) => string },
): { readonly profile: ProjectProfile; readonly confirmed: readonly Statement[]; readonly missing: readonly string[] } {
  const { answers, by, at, nextId } = input;
  if (answers.scale !== undefined && !(PROJECT_SCALES as readonly string[]).includes(answers.scale)) {
    throw new Error(`scale must be one of ${PROJECT_SCALES.join(' | ')}`);
  }
  return store.transaction(() => {
    const confirmed: Statement[] = [];
    const patch: Record<string, unknown> = {};
    if (answers.name) patch.name = answers.name;
    if (answers.purpose) patch.purpose = answers.purpose;
    if (answers.scale) patch.scale = answers.scale;
    if (answers.primaryOutcome) patch.primaryOutcome = answers.primaryOutcome;
    for (const text of answers.protectedConstraints ?? []) {
      if (!text.trim()) continue;
      confirmed.push(addStatement(store, { id: nextId('st'), kind: 'constraint', text: text.trim(), provenance: 'user', at }));
    }
    let profile = upsertProfile(store, patch, at);
    const missing = missingProfileFields(profile);
    if (missing.length === 0 && profile.onboardingState !== 'confirmed') {
      profile = upsertProfile(store, { onboardingState: 'confirmed' }, at);
    }
    for (const d of listOpenDecisions(store)) {
      if (d.kind !== 'clarification') continue;
      if (answers.scale && isOnboardingSubject(d.subject, 'scale')) resolveDecision(store, { id: d.id, resolution: answers.scale, by, at });
      if (answers.primaryOutcome && isOnboardingSubject(d.subject, 'primary_outcome')) resolveDecision(store, { id: d.id, resolution: answers.primaryOutcome, by, at });
      if (answers.protectedConstraints && isOnboardingSubject(d.subject, 'protected_constraints')) {
        resolveDecision(store, { id: d.id, resolution: [...answers.protectedConstraints], by, at });
      }
    }
    return { profile, confirmed, missing };
  });
}

/** A person accepts one proposed statement; nothing else can. */
export function acceptProposal(store: StateStore, statementId: string, at: string): Statement {
  return setStatementStatus(store, { id: statementId, status: 'confirmed', at });
}

export function declineProposal(store: StateStore, statementId: string, at: string): Statement {
  return setStatementStatus(store, { id: statementId, status: 'retired', at });
}

export interface OnboardingStatus {
  readonly state: ProjectProfile['onboardingState'];
  readonly missing: readonly string[];
  readonly openQuestions: readonly Decision[];
  readonly proposalsAwaitingReview: number;
}

export function onboardingStatus(store: StateStore): OnboardingStatus {
  const profile = getProfile(store);
  return {
    state: profile?.onboardingState ?? 'incomplete',
    missing: missingProfileFields(profile),
    openQuestions: listOpenDecisions(store).filter((d) => d.kind === 'clarification' && isOnboardingSubject(d.subject, 'scale') || isOnboardingSubject(d.subject, 'primary_outcome') || isOnboardingSubject(d.subject, 'protected_constraints')),
    proposalsAwaitingReview: listStatements(store, { status: 'proposed' }).length,
  };
}

const LIST_KINDS: ReadonlyArray<readonly [StatementKind, keyof Constitution]> = [
  ['principle', 'principles'],
  ['constraint', 'constraints'],
  ['non_goal', 'nonGoals'],
  ['success_measure', 'successMeasures'],
  ['boundary', 'boundaries'],
  ['unknown', 'unknowns'],
];

/**
 * The committed constitution is the confirmed profile plus confirmed
 * statements. Proposed material never reaches the file; unknowns do, because
 * a declared unknown is itself something a person has accepted not knowing.
 */
export function composeConstitution(store: StateStore, base: Constitution): Constitution {
  const profile = getProfile(store);
  const confirmed = listStatements(store, { status: 'confirmed' });
  const unknowns = listStatements(store, { kind: 'unknown' }).filter((s) => s.status !== 'retired' && s.status !== 'superseded');
  const out: Record<string, unknown> = { ...base };
  if (profile) {
    out.name = profile.name ?? base.name;
    out.purpose = profile.purpose ?? base.purpose;
    out.scale = profile.scale ?? base.scale;
    out.lifecycleStage = profile.lifecycleStage ?? base.lifecycleStage;
    out.primaryOutcome = profile.primaryOutcome ?? base.primaryOutcome;
    out.riskPosture = profile.riskPosture ?? base.riskPosture;
    out.reviewCadence = profile.reviewCadence ?? base.reviewCadence;
  }
  for (const [kind, key] of LIST_KINDS) {
    const texts = (kind === 'unknown' ? unknowns : confirmed.filter((s) => s.kind === kind)).map((s) => s.text);
    out[key] = [...new Set([...(base[key] as readonly string[]), ...texts])];
  }
  const artifacts = confirmed
    .filter((s) => s.kind === 'canonical_artifact')
    .map((s) => {
      const idx = s.text.indexOf(': ');
      return idx === -1 ? { path: s.text, role: 'document' } : { path: s.text.slice(0, idx), role: s.text.slice(idx + 2) };
    });
  out.canonicalArtifacts = [...base.canonicalArtifacts, ...artifacts.filter((a) => !base.canonicalArtifacts.some((b) => b.path === a.path))];
  const glossary = confirmed.filter((s) => s.kind === 'glossary_entry' && s.term).map((s) => ({ term: s.term!, meaning: s.text }));
  out.glossary = [...base.glossary, ...glossary.filter((g) => !base.glossary.some((b) => b.term.toLowerCase() === g.term.toLowerCase()))];
  return out as unknown as Constitution;
}
