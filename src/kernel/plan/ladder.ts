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

/**
 * The required slots a prose deliverable never headed, detected the same way
 * the structural challenges read prose: markdown emphasis flattened away,
 * whitespace collapsed, case ignored. Presence-only on purpose — whether the
 * section under a heading is any good is the substantive question every
 * structural pass declares as its limit, and a headed-but-thin section is the
 * next reader's finding, not this parser's.
 */
export function unheadedSlots(
  template: DeliverableTemplate,
  deliverable: string,
): SlotGap[] {
  const flattened = deliverable.toLowerCase().replace(/[*_`#>-]/g, ' ').replace(/\s+/g, ' ');
  return template.slots
    .filter((slot) => slot.required)
    .filter((slot) => !flattened.includes(slot.name.toLowerCase().replace(/-/g, ' ')))
    .map((slot) => ({ deliverable: template.deliverable, slot }));
}

/** A line read as a slot label: what it names, what followed it, how it was written. */
interface SlotLabel {
  readonly label: string;
  readonly rest: string;
  readonly heading: boolean;
}

const normalizeLabel = (text: string): string =>
  text.toLowerCase().replace(/[*_`]/g, '').replace(/[-\s]+/g, ' ').trim();

/**
 * Whether a line labels a slot, and what it labels it with.
 *
 * A heading labels its whole line. Anything else has to end its label with a
 * colon or an em dash, which is what keeps prose that merely mentions a slot by
 * name — "a different, narrower decision than the one this outcome asks for
 * (see decision-owner above)" — from reading as the slot itself.
 */
function slotLabelOf(raw: string): SlotLabel | null {
  const heading = /^\s*#{1,6}\s+(.*)$/.exec(raw);
  if (heading) {
    const [label, ...rest] = heading[1].split(/\s*[:—]\s*/);
    return { label: normalizeLabel(label), rest: rest.join(': ').trim(), heading: true };
  }
  const inline = /^[\s>*_`-]*([^:—\n]{1,60}?)[*_`]*\s*[:—]\s*(.*)$/.exec(raw);
  if (!inline) return null;
  return {
    label: normalizeLabel(inline[1]),
    rest: inline[2].replace(/^[\s*_`]+/, '').trim(),
    heading: false,
  };
}

/**
 * What a deliverable wrote in one named slot, or null if it never headed it.
 *
 * `unheadedSlots` above answers whether the slot is there; this answers what is
 * in it, which is what a check about a specific slot's content needs. The two
 * read prose the same way on purpose — one parser for one shape, so a heading
 * form that satisfies the gap detector cannot be invisible to the checks.
 *
 * Reading the slot is how a structural check learns what an attribution is
 * about. A checker cannot tell from a sentence which decision an owner owns;
 * it can tell that a name stands in the slot the template asked the owner
 * question in, and that is the same information arrived at honestly.
 */
export function slotSection(deliverable: string, slotName: string): string | null {
  const wanted = normalizeLabel(slotName);
  const lines = deliverable.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const labelled = slotLabelOf(lines[i]);
    if (!labelled || labelled.label !== wanted) continue;
    if (labelled.rest) return labelled.rest;
    if (!labelled.heading) continue;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^\s*#{1,6}\s/.test(lines[j])) break;
      body.push(lines[j]);
    }
    const text = body.join('\n').trim();
    if (text) return text;
  }
  return null;
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
