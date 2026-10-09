/**
 * kernel/project/onboarding.ts — from a discovery draft to a confirmed profile.
 *
 * Applying a draft records proposals as proposed statements and drafted
 * profile fields, and raises the initial questions as clarifications in the
 * inbox. Answers and acceptances are the only way anything becomes confirmed.
 * Discovery's guess at the project's scale is shown in the scale question and
 * never applied. A setup answer lands in the profile on whichever channel it
 * arrives, in the question's own words or its ids, but only the person's own
 * channel can make a project a side project: that alone makes work lighter.
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
import { bindGoverningStatement } from '../state/admission.ts';
import { isPersonChannel, PersonChannelRequiredError, type DecisionChannel } from '../policy/channels.ts';
import { appendActivity } from '../state/activity.ts';
import type { Constitution } from './constitution.ts';
import { ONBOARDING_QUESTIONS, SCALE_CHOICES, type DiscoveryDraft, type OnboardingQuestion } from './discovery.ts';

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
        addStatement(store, {
          id: nextId('st'),
          kind: s.kind,
          text: s.text,
          term: s.term,
          provenance: 'discovery',
          locator: s.provenance.path,
          span: { startLine: s.provenance.line },
          excerpt: s.provenance.excerpt,
          sourceRevision: s.provenance.contentDigest,
          extractorVersion: s.provenance.extractorVersion,
          contentDigest: s.provenance.contentDigest,
          quoted: s.provenance.quoted === true,
          at,
        }),
      );
    }
    for (const c of draft.canonicalArtifacts) {
      const text = `${c.path}: ${c.role}`;
      if (existing.some((e) => e.kind === 'canonical_artifact' && e.text === text)) continue;
      proposed.push(addStatement(store, { id: nextId('st'), kind: 'canonical_artifact', text, provenance: 'discovery', at }));
    }
    const answered = answeredUnknowns(profile, existing.filter((e) => e.status === 'confirmed'));
    for (const u of draft.unknowns) {
      if (answered.has(u)) continue;
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
    const guess = scaleGuess(draft);
    const questions: Decision[] = [];
    for (const q of draft.questions) {
      const already = open.find((d) => d.kind === 'clarification' && isOnboardingSubject(d.subject, q.id));
      if (already) {
        questions.push(already);
        continue;
      }
      const suggests = q.id === 'scale' ? guess : null;
      questions.push(
        raiseDecision(store, {
          id: nextId('q'),
          kind: 'clarification',
          question: suggests ? `${q.question} ${suggests.line}` : q.question,
          options: q.options,
          subject: suggests ? { onboarding: q.id, suggested: suggests.suggested, basis: suggests.basis } : { onboarding: q.id },
          at,
        }),
      );
    }
    return { profile, proposedStatements: proposed, questions };
  });
}

/**
 * What the project's own files suggest its scale is, put to the person as a
 * suggestion to confirm or correct. Null when the files suggest nothing.
 */
function scaleGuess(draft: DiscoveryDraft): { readonly suggested: ProjectScale; readonly basis: string; readonly line: string } | null {
  const proposal = draft.profile.find((p) => p.field === 'scale');
  const choice = proposal ? SCALE_CHOICES.find((c) => c.id === proposal.value) : undefined;
  if (!proposal || !choice) return null;
  const { path, excerpt } = proposal.provenance;
  return {
    suggested: choice.id,
    basis: `${excerpt} in ${path}`,
    line: `From ${path} (${excerpt}) this looks like ${choice.label} (${choice.id}); say whether that is right.`,
  };
}

/** Unknowns a profile field or a confirmed statement has since answered; they stop being unknown. */
function answeredUnknowns(profile: ProjectProfile | null, confirmed: readonly Statement[]): Set<string> {
  const out = new Set<string>();
  if (profile?.purpose) out.add('purpose');
  if (profile?.primaryOutcome) out.add('primary outcome');
  if (profile?.riskPosture) out.add('risk posture');
  if (profile?.reviewCadence) out.add('review cadence');
  if (confirmed.some((s) => s.kind === 'success_measure')) out.add('success measures');
  return out;
}

function retireAnsweredUnknowns(store: StateStore, at: string): void {
  const answered = answeredUnknowns(getProfile(store), listStatements(store, { status: 'confirmed' }));
  for (const u of listStatements(store, { kind: 'unknown' })) {
    if (answered.has(u.text) && u.status !== 'retired' && u.status !== 'superseded') setStatementStatus(store, { id: u.id, status: 'retired', at });
  }
}

function isOnboardingSubject(subject: unknown, id: OnboardingQuestion['id']): boolean {
  return onboardingQuestionOf(subject) === id;
}

/** The setup question a decision's subject asks, or null when it asks none. */
export function onboardingQuestionOf(subject: unknown): OnboardingQuestion['id'] | null {
  const id = subject !== null && typeof subject === 'object' ? (subject as { onboarding?: unknown }).onboarding : undefined;
  return ONBOARDING_QUESTIONS.find((q) => q.id === id)?.id ?? null;
}

/** Leading words an answer may carry that name no scale: articles, possessives, and "it is" or "this is". */
const ANSWER_LEADS = ['it is', 'its', 'this is', 'a', 'an', 'the', 'my', 'our', 'your'] as const;

/** An answer reduced to its words: case, width, dashes, underscores, punctuation and leading articles set aside. */
function answerWords(text: string): string {
  let t = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{Pd}_]/gu, ' ')
    .replace(/\p{P}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  for (;;) {
    const lead = ANSWER_LEADS.find((l) => t.startsWith(`${l} `));
    if (!lead) return t;
    t = t.slice(lead.length + 1);
  }
}

/**
 * The scale an answer names: one of the scale question's choices, by its id or
 * the question's own phrase for it. It maps words to an id and never guesses:
 * anything else is refused with the choices listed.
 */
export function scaleFromAnswer(text: string): ProjectScale {
  const said = answerWords(text);
  const choice = SCALE_CHOICES.find((c) => [c.id, c.label, ...c.also].some((form) => answerWords(form) === said));
  if (choice) return choice.id;
  throw new Error(`${JSON.stringify(text)} is not one of them: ${SCALE_CHOICES.map((c) => `${c.label} (${c.id})`).join(' | ')}`);
}

/**
 * A person's answer to a setup question, as the answers applyOnboardingAnswers
 * takes. Null when the subject asks no setup question.
 */
export function onboardingAnswerFor(subject: unknown, resolution: unknown): OnboardingAnswers | null {
  const id = onboardingQuestionOf(subject);
  if (id === null) return null;
  const words = typeof resolution === 'string' ? [resolution] : Array.isArray(resolution) && resolution.every((r) => typeof r === 'string') ? (resolution as string[]) : null;
  if (words === null) throw new Error('a setup question is answered in words');
  if (id === 'scale') return { scale: scaleFromAnswer(words.join(' ')) };
  if (id === 'primary_outcome') return { primaryOutcome: words.join(' ') };
  return { protectedConstraints: words };
}

/** Why a side project needs the person: it is the one answer that makes work lighter. */
export const SIDE_PROJECT_NEEDS_PERSON = 'Setting this project to a side project, which lowers how much challenge work gets,';

function unknownResolvedByProfile(text: string, profile: ProjectProfile | null, answers: OnboardingAnswers): boolean {
  if (text === 'purpose' && Boolean(answers.purpose || profile?.purpose)) return true;
  if (text === 'primary outcome' && Boolean(answers.primaryOutcome || profile?.primaryOutcome)) return true;
  if (text === 'risk posture' && Boolean(profile?.riskPosture)) return true;
  if (text === 'review cadence' && Boolean(profile?.reviewCadence)) return true;
  return false;
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
 * Each protected constraint keeps the channel its answer arrived on, so one
 * an assistant relayed never counts as the person's own rule. A side project
 * is set only on the person's own channel; on any other, or with none named,
 * the answers are refused and nothing is applied.
 */
export function applyOnboardingAnswers(
  store: StateStore,
  input: { readonly answers: OnboardingAnswers; readonly by: string; readonly at: string; readonly nextId: (prefix: string) => string; readonly channel?: DecisionChannel },
): { readonly profile: ProjectProfile; readonly confirmed: readonly Statement[]; readonly missing: readonly string[] } {
  const { answers, by, at, nextId, channel } = input;
  if (answers.scale !== undefined && !(PROJECT_SCALES as readonly string[]).includes(answers.scale)) {
    throw new Error(`scale must be one of ${PROJECT_SCALES.join(' | ')}`);
  }
  if (answers.scale === 'side_project' && !(channel && isPersonChannel(channel))) {
    const asked = listOpenDecisions(store).find((d) => d.kind === 'clarification' && isOnboardingSubject(d.subject, 'scale'));
    throw new PersonChannelRequiredError(SIDE_PROJECT_NEEDS_PERSON, asked?.id ?? null, 'side_project');
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
      confirmed.push(addStatement(store, { id: nextId('st'), kind: 'constraint', text: text.trim(), provenance: 'user', ...(channel ? { channel } : {}), at }));
    }
    let profile = upsertProfile(store, patch, at);
    for (const unknown of listStatements(store, { kind: 'unknown', status: 'proposed' })) {
      if (unknownResolvedByProfile(unknown.text, profile, answers)) {
        setStatementStatus(store, { id: unknown.id, status: 'retired', at });
      }
    }
    retireAnsweredUnknowns(store, at);
    const missing = missingProfileFields(profile);
    if (missing.length === 0 && profile.onboardingState !== 'confirmed') {
      profile = upsertProfile(store, { onboardingState: 'confirmed' }, at);
    }
    for (const d of listOpenDecisions(store)) {
      if (d.kind !== 'clarification') continue;
      if (answers.scale && isOnboardingSubject(d.subject, 'scale')) resolveDecision(store, { id: d.id, resolution: answers.scale, by, at, channel });
      if (answers.primaryOutcome && isOnboardingSubject(d.subject, 'primary_outcome')) resolveDecision(store, { id: d.id, resolution: answers.primaryOutcome, by, at, channel });
      if (answers.protectedConstraints && answers.protectedConstraints.length > 0 && isOnboardingSubject(d.subject, 'protected_constraints')) {
        resolveDecision(store, { id: d.id, resolution: [...answers.protectedConstraints], by, at, channel });
      }
    }
    return { profile, confirmed, missing };
  });
}

/** Confirm one proposed statement, keeping the channel the confirmation arrived on: only one on the person's own channel is in their voice. */
export function acceptProposal(
  store: StateStore,
  statementId: string,
  at: string,
  nextId: (prefix: string) => string,
  channel?: DecisionChannel,
): Statement {
  const statement = setStatementStatus(store, { id: statementId, status: 'confirmed', at, ...(channel ? { channel } : {}) });
  bindGoverningStatement(store, statement, at, nextId);
  return statement;
}

export function declineProposal(store: StateStore, statementId: string, at: string): Statement {
  return setStatementStatus(store, { id: statementId, status: 'retired', at });
}

export type InboxRow =
  | {
      readonly kind: 'inbox_item';
      readonly id: string;
      readonly decisionKind: Decision['kind'];
      readonly question: string;
      readonly options: readonly string[] | null;
      readonly raisedAt: string;
      readonly run: string | null;
    }
  | {
      readonly kind: 'proposal';
      readonly id: string;
      readonly statementKind: Statement['kind'];
      readonly question: string;
      readonly options: readonly ['confirm', 'retire'];
      readonly text: string;
      readonly raisedAt: string;
      readonly run: null;
    };

/** Decisions waiting on the person, plus proposed statements they have not reviewed. */
export function listInbox(store: StateStore, runId?: string): InboxRow[] {
  const decisions: InboxRow[] = listOpenDecisions(store, runId).map((d) => ({
    kind: 'inbox_item',
    id: d.id,
    decisionKind: d.kind,
    question: d.question,
    options: d.options,
    raisedAt: d.raisedAt,
    run: d.runId,
  }));
  if (runId) return decisions;
  const proposals: InboxRow[] = listStatements(store, { status: 'proposed' }).map((s) => ({
    kind: 'proposal',
    id: s.id,
    statementKind: s.kind,
    question: `Accept this ${s.kind.replace(/_/g, ' ')}?`,
    options: ['confirm', 'retire'] as const,
    text: s.text,
    raisedAt: s.createdAt,
    run: null,
  }));
  return [...decisions, ...proposals];
}

/**
 * Confirm or retire a proposed statement, recording who answered and on which
 * channel. A relayed confirmation is allowed and recorded as relayed, so the
 * statement is in the assistant's voice, not the person's.
 */
export function resolveProposal(
  store: StateStore,
  input: { readonly id: string; readonly resolution: string; readonly at: string; readonly nextId: (prefix: string) => string; readonly by: string; readonly channel: DecisionChannel },
): Statement {
  const answer = input.resolution.trim().toLowerCase();
  const confirm = answer === 'confirm' || answer === 'accept' || answer === 'yes';
  if (!confirm && answer !== 'retire' && answer !== 'decline' && answer !== 'no') {
    throw new Error(`a proposal is answered with confirm or retire, not ${JSON.stringify(input.resolution)}`);
  }
  return store.transaction(() => {
    const statement = confirm ? acceptProposal(store, input.id, input.at, input.nextId, input.channel) : declineProposal(store, input.id, input.at);
    appendActivity(store, { at: input.at, kind: 'proposal.resolved', actor: input.by, payload: { statementId: statement.id, kind: statement.kind, status: statement.status, channel: input.channel } });
    return statement;
  });
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
    openQuestions: listOpenDecisions(store).filter(
      (d) =>
        d.kind === 'clarification' &&
        (isOnboardingSubject(d.subject, 'scale') ||
          isOnboardingSubject(d.subject, 'primary_outcome') ||
          isOnboardingSubject(d.subject, 'protected_constraints')),
    ),
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
  const answered = answeredUnknowns(profile, confirmed);
  const unknowns = listStatements(store, { kind: 'unknown' }).filter(
    (s) => s.status !== 'retired' && s.status !== 'superseded' && !unknownResolvedByProfile(s.text, profile, {}) && !answered.has(s.text),
  );
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
