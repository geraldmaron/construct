/**
 * kernel/plan/ladder.ts — the acquisition ladder: what happens when a required
 * slot is empty. A gap is never a stall; it is a defined climb: read the
 * declared sources, research beyond them, ask the human, and finally
 * assume-and-label. Every rung ends in a draft; asking never blocks one.
 *
 * Asking the human is batched to the decision inbox, and every question ships
 * with its assumed default. In the inbox's own shape that is two positions —
 * the gap and the default the draft proceeds on — which is honest to the
 * inbox's rule that a one-sided question is a report, not a decision: the
 * human's resolution either confirms the default or replaces it, and until it
 * arrives the draft carries the default, labeled.
 */

import type { Store } from '../store/open.ts';
import { raiseDecision } from '../store/decisions.ts';
import { ACQUISITION_LADDER } from './schema.ts';
import type { AcquisitionRung, DeliverableTemplate, Slot } from './schema.ts';

/** A required slot with nothing in it: the machine-checkable information gap. */
export interface SlotGap {
  readonly deliverable: string;
  readonly slot: Slot;
}

/**
 * The gaps in a filled-out deliverable. `filled` maps slot name to content; a
 * missing key, empty string, or whitespace is unfilled. Optional slots are
 * never gaps — their emptiness is information, not absence.
 */
export function slotGaps(
  template: DeliverableTemplate,
  filled: Readonly<Record<string, string>>,
): SlotGap[] {
  return template.slots
    .filter((slot) => slot.required && !(filled[slot.name] ?? '').trim())
    .map((slot) => ({ deliverable: template.deliverable, slot }));
}

/** What one gap should do next, given how far it has already climbed. */
export function nextRung(climbed: readonly AcquisitionRung[]): AcquisitionRung | null {
  for (const rung of ACQUISITION_LADDER) {
    if (!climbed.includes(rung)) return rung;
  }
  // The ladder is exhausted: assume-and-label already produced a labeled
  // assumption, and there is nothing above it to climb to.
  return null;
}

export interface AskHumanQuestion {
  readonly gap: SlotGap;
  /** The default the draft proceeds on until the human answers. */
  readonly assumedDefault: string;
  /** Why this default and not another — the citation a position carries. */
  readonly basis: string;
}

/**
 * Batch ask-human questions into the decision inbox in one pass: one decision
 * per gap, raised together so the human sees the whole set at once instead of
 * being pinged per slot. Returns the decision ids, in the order raised.
 */
export function batchAskHuman(
  store: Store,
  run: string,
  planId: string,
  questions: readonly AskHumanQuestion[],
  raisedAt: string,
): string[] {
  const ids: string[] = [];
  for (const [index, q] of questions.entries()) {
    if (q.assumedDefault.trim() === '') {
      // A question without a default is a stall wearing a question mark.
      throw new Error(
        `batchAskHuman: the question for slot "${q.gap.slot.name}" ships no assumed default`,
      );
    }
    const id = `${planId}-ask-${index + 1}`;
    raiseDecision(store, {
      id,
      run,
      question: `${q.gap.deliverable}: what belongs in "${q.gap.slot.name}" (${q.gap.slot.expects})?`,
      positions: [
        {
          role: 'plan',
          stance: `the slot is unfilled after reading sources and research`,
          citation: null,
        },
        {
          role: 'assumed-default',
          stance: q.assumedDefault,
          citation: q.basis,
        },
      ],
      raisedAt,
    });
    ids.push(id);
  }
  return ids;
}
