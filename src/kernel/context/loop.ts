/**
 * kernel/context/loop.ts — the context loop: what happens to a note after it
 * arrives and before anything downstream believes it.
 *
 * The pipeline the rung defines: a note is densified (a host model call,
 * through the same seam as intake), cross-referenced against memory and
 * sources, and what comes out is three things — a confirm-intent summary back
 * to the user, memory deltas routed through the existing lesson admission
 * gate, and propagation proposals filed through the write-proposal consent
 * machinery. The kernel owns none of the judgment about *what* to conclude;
 * a host model proposes the deltas and proposals, and this module owns the
 * discipline of applying them:
 *
 *   - Every delta and every proposal justifies itself by a citation into the
 *     note it came from, and the citation must resolve to a real line of that
 *     exact note. A conclusion that cannot point at the words it came from is
 *     fabricated provenance — the catastrophe class, so a hard refusal, not a
 *     judgment call.
 *   - Deltas do not become operational memory here. They become lessons, and
 *     each one goes through `decideAdmission` — the gate keeps its ordering
 *     (external before tier), and the loop gets no side door around it.
 *   - Proposals do not become writes here. They become proposal rows, and the
 *     rung 0 machinery — human decisions, standing consent for low-risk —
 *     decides their fate. Filing grants nothing.
 *   - A fact about a named subject goes to that subject's record, not to
 *     workspace memory. Both are things the note taught; only one of them is
 *     standing operating knowledge every later dispatch reasons from, and
 *     filing "Acme's renewal moved to Q3" as the second is how a workspace
 *     comes to hold one client's calendar as a general rule.
 *   - Application is transactional: either the whole loop's output lands, or
 *     none of it does. A half-applied loop would leave deltas admitted whose
 *     sibling proposals vanished.
 */

import type { Store } from '../store/open.ts';
import { transact } from '../store/open.ts';
import { getNote, resolveNoteCitation } from '../store/notes.ts';
import { recordLesson, type LessonKind } from '../store/lessons.ts';
import {
  decideAdmission,
  type AdmissionBasis,
  type AdmissionDecision,
} from '../lessons/admission.ts';
import { proposeWrite } from '../store/sources.ts';
import { getRecord, updateRecordField } from '../store/records.ts';
import type { DensifiedIntake } from '../intake/densify.ts';

/** A proposed change to memory: a lesson-to-be, citing the note line that taught it. */
export interface MemoryDelta {
  readonly id: string;
  readonly kind: LessonKind;
  /** The domain the delta teaches about; the admission gate derives the tier from it. */
  readonly domain: string;
  readonly body: string;
  /** A note citation (`note:<id>#L<n>`) into the note this loop is applying. */
  readonly citation: string;
  /**
   * A note is usually the user's own words, but a dump that pastes an external
   * document's text carries that document's risk: marking the delta external
   * routes it to human review no matter the tier.
   */
  readonly external: boolean;
  readonly basis: AdmissionBasis;
  readonly supersedes?: string | null;
}

/** A proposed change outside this system, justified by a note line, decided by rung 0. */
export interface PropagationProposal {
  readonly id: string;
  readonly source: string;
  readonly change: string;
  /** A note citation (`note:<id>#L<n>`) into the note this loop is applying. */
  readonly justification: string;
  readonly risk: 'low' | 'high';
}

/**
 * A fact about a named subject, headed for that subject's record rather than
 * workspace memory. It goes through no admission gate: a gate exists to decide
 * whether a claim becomes standing operating knowledge every later dispatch
 * reasons from, and a field on one customer's record is not that. What it is
 * held to instead is the same citation discipline as everything else here,
 * plus the record actually existing — an update to a subject nobody declared
 * would invent the subject as a side effect of describing it.
 */
export interface RecordUpdate {
  readonly record: string;
  readonly field: string;
  readonly value: string;
  /** A note citation (`note:<id>#L<n>`) into the note this loop is applying. */
  readonly citation: string;
}

export interface ContextLoopInput {
  readonly workspace: string;
  readonly run: string;
  readonly noteId: string;
  readonly densified: DensifiedIntake;
  readonly deltas: readonly MemoryDelta[];
  readonly proposals: readonly PropagationProposal[];
  readonly records?: readonly RecordUpdate[];
}

export interface ContextLoopResult {
  /** The confirm-intent text shown back to the user before anything is believed. */
  readonly summary: string;
  /** One admission decision per delta, in delta order; held is an outcome, not an error. */
  readonly admissions: readonly AdmissionDecision[];
  /** Proposal ids now sitting in the rung 0 queue, in proposal order. */
  readonly filed: readonly string[];
  /** Record fields moved by this pass, as "<record> <field>", in update order. */
  readonly updated: readonly string[];
}

/**
 * The summary sent back before anything moves: the densified reading, restated
 * so the user confirms what was understood rather than what was written.
 * Deterministic assembly — the judgment already happened in densification, and
 * a summary that re-paraphrased it would be a second reading nobody checked.
 */
export function confirmIntentSummary(densified: DensifiedIntake): string {
  const lines: string[] = [
    'Here is what I took from your notes. Nothing has been saved or sent — confirm this reading first.',
    '',
    `Outcome: ${densified.outcome}`,
  ];
  const section = (title: string, items: readonly string[]): void => {
    if (items.length === 0) return;
    lines.push('', `${title}:`);
    for (const item of items) lines.push(`- ${item}`);
  };
  section('Decisions you already made', densified.decisions);
  section('Constraints', densified.constraints);
  section('Parked (kept visible, not this outcome)', densified.parked);
  if (densified.underspecified.length > 0) {
    lines.push('', `This is thin enough to need a guess: ${densified.underspecified}`);
  }
  return lines.join('\n');
}

function requireCitation(store: Store, noteId: string, what: string, citation: string): void {
  const resolved = resolveNoteCitation(store, citation);
  if (!resolved) {
    throw new Error(
      `applyContextLoop: ${what} cites "${citation}", which resolves to no line of any recorded note`,
    );
  }
  if (resolved.note.id !== noteId) {
    // Citing a different note than the one being applied is how a stale or
    // unrelated justification would launder itself into this loop's output.
    throw new Error(
      `applyContextLoop: ${what} cites note ${resolved.note.id}, not the note being applied (${noteId})`,
    );
  }
}

/**
 * Apply one loop pass: record the deltas as lessons and run each through the
 * admission gate, file the proposals into the rung 0 queue, and return the
 * confirm-intent summary. All or nothing; every output cites its note line.
 */
export function applyContextLoop(
  store: Store,
  input: ContextLoopInput,
  appliedAt: string,
): ContextLoopResult {
  const note = getNote(store, input.noteId);
  if (!note) throw new Error(`applyContextLoop: no note ${input.noteId}`);
  if (note.workspace !== input.workspace) {
    throw new Error(
      `applyContextLoop: note ${note.id} belongs to ${note.workspace}, not ${input.workspace}`,
    );
  }

  return transact(store, () => {
    const admissions: AdmissionDecision[] = [];
    for (const delta of input.deltas) {
      requireCitation(store, note.id, `delta ${delta.id}`, delta.citation);
      recordLesson(store, {
        id: delta.id,
        workspace: input.workspace,
        kind: delta.kind,
        body: delta.body,
        citation: delta.citation,
        external: delta.external,
        supersedes: delta.supersedes ?? null,
        createdAt: appliedAt,
      });
      admissions.push(
        decideAdmission(store, {
          lessonId: delta.id,
          domain: delta.domain,
          basis: delta.basis,
          decidedAt: appliedAt,
        }),
      );
    }

    const filed: string[] = [];
    for (const proposal of input.proposals) {
      requireCitation(store, note.id, `proposal ${proposal.id}`, proposal.justification);
      proposeWrite(store, {
        id: proposal.id,
        workspace: input.workspace,
        run: input.run,
        source: proposal.source,
        change: proposal.change,
        justification: proposal.justification,
        risk: proposal.risk,
        proposedAt: appliedAt,
      });
      filed.push(proposal.id);
    }

    const updated: string[] = [];
    for (const update of input.records ?? []) {
      requireCitation(store, note.id, `record update ${update.record}.${update.field}`, update.citation);
      const subject = getRecord(store, update.record);
      if (!subject) {
        throw new Error(
          `applyContextLoop: record update cites ${update.record}, which this workspace does not keep`,
        );
      }
      if (subject.workspace !== input.workspace) {
        throw new Error(
          `applyContextLoop: record ${update.record} belongs to ${subject.workspace}, not ${input.workspace}`,
        );
      }
      updateRecordField(store, {
        record: update.record,
        field: update.field,
        value: update.value,
        citation: update.citation,
        recordedAt: appliedAt,
      });
      updated.push(`${update.record} ${update.field}`);
    }

    return {
      summary: confirmIntentSummary(input.densified),
      admissions,
      filed,
      updated,
    };
  });
}
