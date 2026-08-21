/**
 * kernel/context/note-loop.ts — the context loop run over one recorded note.
 *
 * loop.ts owns the gate a delta, a proposal and a record update have to pass;
 * this owns the pass that produces them — densify, produce, challenge each
 * delta adversarially, screen what cites nothing, then apply. The three model
 * calls are injected as the seam types the kernel already declares
 * (`ContextProducer`, `DeltaChallenger`, and a densifier), so nothing here
 * knows which host answered, and a test can drive the whole pass without one.
 */

import type { Store } from '../store/open.ts';
import type { Source } from '../store/sources.ts';
import { resolveNoteCitation } from '../store/notes.ts';
import { currentFields, getRecord, recordsFor } from '../store/records.ts';
import { operationalLessonsFor } from '../lessons/admission.ts';
import { applyContextLoop } from './loop.ts';
import type { MemoryDelta, PropagationProposal, RecordUpdate } from './loop.ts';
import { toProducedLoop } from './produce.ts';
import type {
  ContextProducer,
  DeltaChallenge,
  DeltaChallenger,
  ProducedLoop,
  ProducerSource,
} from './produce.ts';
import { screenObservations } from './observations.ts';
import type { DocumentWords, ScreenResult } from './observations.ts';
import { subjectsOf } from './subjects.ts';
import type { DensifiedIntake } from '../intake/densify.ts';
import { escapeForTerminal } from '../render/terminal.ts';
import type { Report } from '../render/report.ts';

/**
 * How many of the subjects a note names are shown to the loop. A note that
 * genuinely concerns a dozen clients at once is a note about a portfolio, and
 * the loop is not the surface for it; what the cap drops is stated rather than
 * silently trimmed off the end of a prompt.
 */
export const SUBJECTS_PER_NOTE = 10;

/** Whatever puts a raw note into the loop's reading of it. */
export type Densifier = (raw: string) => Promise<DensifiedIntake>;

export interface NoteLoopCalls {
  readonly densify: Densifier;
  readonly produce: ContextProducer;
  readonly challenge: DeltaChallenger;
}

export interface NoteLoopInput {
  readonly noteId: string;
  readonly body: string;
  readonly workspace: string;
  readonly run?: string;
  readonly at: string;
  readonly sources: readonly Source[];
  readonly producerSources: readonly ProducerSource[];
  readonly surveyed: ReadonlyMap<string, ReadonlySet<string>>;
  readonly words: DocumentWords;
  readonly report: Report;
}

/**
 * Whether the loop completed, and what its observations came to when it did.
 * A note whose loop failed keeps its row: the evidence landed before any model
 * was consulted, and a later pass can always run over it.
 */
export type NoteLoopOutcome =
  | { readonly ran: false }
  | { readonly ran: true; readonly drift: ScreenResult };

/**
 * Run the context loop over one recorded note: densify, produce, challenge
 * each delta adversarially, then apply — deltas through the admission gate,
 * proposals into the rung 0 queue, observations through the citation screen.
 */
export async function runNoteLoop(
  store: Store,
  calls: NoteLoopCalls,
  input: NoteLoopInput,
): Promise<NoteLoopOutcome> {
  const { noteId, body, workspace, sources, producerSources, surveyed, words, at, report } = input;

  // Densify first: the confirm-intent summary is a restatement of this
  // reading, and a loop that cannot state its reading has nothing to
  // confirm. The note is already safe, so failing here loses no evidence.
  let densified: DensifiedIntake;
  try {
    densified = await calls.densify(body);
  } catch (error) {
    report.warn(
      `notes: the note could not be densified (${escapeForTerminal((error as Error).message)}). ` +
        `It is recorded as ${noteId}; run the loop again when the host answers.\n`,
    );
    return { ran: false };
  }

  const subjects = subjectsOf(body, recordsFor(store, workspace), SUBJECTS_PER_NOTE);
  if (subjects.withheld > 0) {
    report.say(
      `  ${String(subjects.withheld)} record${subjects.withheld === 1 ? '' : 's'} this note names ` +
        `${subjects.withheld === 1 ? 'was' : 'were'} not shown to the loop (limit ${String(SUBJECTS_PER_NOTE)}); ` +
        'nothing was recorded against them.\n',
    );
  }

  let produced: ProducedLoop;
  try {
    const reply = await calls.produce({
      noteBody: body,
      noteId,
      lessons: operationalLessonsFor(store, workspace).map((l) => l.body),
      sources: producerSources,
      // Only the subjects this note names, with what each says now. Two
      // reasons, and the first is the serious one: a workspace holding several
      // clients would otherwise put one client's fields into the prompt
      // reasoning over another's call notes. The second is that an update must
      // name the record it changes, so a subject the note never mentions is
      // one the note cannot determine anything about — showing it buys
      // nothing and risks a fact being filed against the wrong client.
      records: subjects.shown.map((r) => ({
        id: r.id,
        kind: r.kind,
        name: r.name,
        fields: currentFields(store, r.id).map((f) => ({ field: f.field, value: f.value })),
      })),
    });
    produced = toProducedLoop(reply, noteId);
  } catch (error) {
    report.warn(
      `notes: the loop could not read the note (${escapeForTerminal((error as Error).message)}). ` +
        `It is recorded as ${noteId}; run the loop again when the host answers.\n`,
    );
    return { ran: false };
  }
  for (const reason of produced.discarded) {
    report.say(`  discarded: ${escapeForTerminal(reason)}\n`);
  }

  // The screen before the gate: a citation that does not resolve, or a
  // proposal against an undeclared source, is dropped here with its reason
  // so one bad item does not abort the pass; the loop's hard gate stays the
  // backstop for anything that slips past.
  const sourceIds = new Set(sources.map((s) => s.id));
  const deltas: MemoryDelta[] = [];
  for (const [i, delta] of produced.deltas.entries()) {
    const cited = resolveNoteCitation(store, delta.citation);
    if (!cited) {
      report.say(
        `  discarded: delta "${escapeForTerminal(delta.body.slice(0, 60))}" cites ${escapeForTerminal(delta.citation)}, which is not a line of this note\n`,
      );
      continue;
    }
    let challenge: DeltaChallenge;
    try {
      challenge = await calls.challenge(delta, cited.text);
    } catch (error) {
      report.say(
        `  held back: delta "${escapeForTerminal(delta.body.slice(0, 60))}" could not be challenged (${escapeForTerminal((error as Error).message)}); an unchallenged delta is not recorded\n`,
      );
      continue;
    }
    if (!challenge.upheld) {
      report.say(
        `  refuted: delta "${escapeForTerminal(delta.body.slice(0, 60))}" — ${escapeForTerminal(challenge.detail)}\n`,
      );
      continue;
    }
    deltas.push({
      id: `${noteId}-d${i + 1}`,
      kind: delta.kind,
      domain: delta.domain,
      body: delta.body,
      citation: delta.citation,
      external: delta.external,
      basis: { kind: 'adversarial-pass', detail: challenge.detail },
    });
  }

  const proposals: PropagationProposal[] = [];
  for (const [i, proposal] of produced.proposals.entries()) {
    if (!sourceIds.has(proposal.source)) {
      report.say(
        `  discarded: proposal "${escapeForTerminal(proposal.change.slice(0, 60))}" targets ${escapeForTerminal(proposal.source)}, which is not a declared source\n`,
      );
      continue;
    }
    if (!resolveNoteCitation(store, proposal.justification)) {
      report.say(
        `  discarded: proposal "${escapeForTerminal(proposal.change.slice(0, 60))}" cites ${escapeForTerminal(proposal.justification)}, which is not a line of this note\n`,
      );
      continue;
    }
    proposals.push({
      id: `${noteId}-p${i + 1}`,
      source: proposal.source,
      change: proposal.change,
      justification: proposal.justification,
      risk: proposal.risk,
    });
  }

  // The same screen the proposals get: an update naming a record this
  // workspace does not keep is dropped with its reason rather than aborting
  // the pass, and the loop's hard refusal stays the backstop.
  const records: RecordUpdate[] = [];
  for (const update of produced.records) {
    if (!getRecord(store, update.record)) {
      report.say(
        `  discarded: record update ${escapeForTerminal(update.record)}.${escapeForTerminal(update.field)} names a record this workspace does not keep\n`,
      );
      continue;
    }
    records.push(update);
  }

  const result = applyContextLoop(
    store,
    {
      workspace,
      run: input.run ?? noteId,
      noteId,
      densified,
      deltas,
      proposals,
      records,
    },
    at,
  );

  report.say(`\n${escapeForTerminal(result.summary)}\n`);

  if (result.admissions.length > 0) {
    report.say('\nmemory deltas (through the admission gate):\n');
    for (const admission of result.admissions) {
      report.say(`  ${admission.verdict}: ${escapeForTerminal(admission.lesson)} — ${escapeForTerminal(admission.reason)}\n`);
    }
  }
  if (result.updated.length > 0) {
    report.say(
      `\nrecords updated (${String(result.updated.length)}) — each field cites the note line that moved it:\n`,
    );
    for (const moved of result.updated) report.say(`  ${escapeForTerminal(moved)}\n`);
  }
  if (result.filed.length > 0) {
    report.say(
      `\nfiled ${result.filed.length} propagation proposal${result.filed.length === 1 ? '' : 's'} — ` +
        'each waits for a decision; nothing was written outward:\n',
    );
    for (const id of result.filed) report.say(`  ${id}\n`);
  }

  return { ran: true, drift: screenObservations(produced.observations, sources, surveyed, words) };
}
