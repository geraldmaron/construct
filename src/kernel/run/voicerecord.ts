/**
 * kernel/run/voicerecord.ts — reading back the voice a run was worked in.
 *
 * THE OVERRIDE LIVES IN THE WORK LOG, for the same reason verdicts do (see
 * promotion.ts): the log is append-only at the storage layer, it is written at
 * the moment the fact becomes true, and a second table would have to re-earn
 * that guarantee. The coordinator writes one entry per dispatch a user's voice
 * shaped. This is the other half of that seam, and until it existed the record
 * was written and never read by anything that needed it.
 *
 * What its absence cost: a run worked under a voice override came back with
 * deliverables in the user's voice and a composed document in the house voice,
 * because composing had no way to recover the instruction and nothing told the
 * user it needed re-stating. A value the user has to retype to keep is a value
 * the system can silently lose, and losing this one is invisible on the page —
 * the document reads perfectly well, in the wrong voice.
 *
 * The latest entry wins. An override is a statement about the run and not about
 * one task, so two invocations naming different voices are the user changing
 * their mind rather than asking for a document in two registers, and the newer
 * instruction is the one they last asked for. Order is the log's own `seq`,
 * which is what readWorkLog returns them in, rather than the timestamp: the
 * timestamps are caller-supplied, and a skewed clock must not be able to decide
 * which voice a document is written in.
 */

import type { Store } from '../store/open.ts';
import { readWorkLog } from '../store/worklog.ts';
import type { VoiceOverride } from '../voice/voice.ts';

/**
 * The action the coordinator files when a user's voice shaped a dispatch, named
 * where it is written and where it is read back so the two cannot drift into
 * being two different actions.
 */
export const VOICE_OVERRIDE_ACTION = 'voice-overridden';

/**
 * The voice a run was worked in, or null where nothing overrode the house
 * voice — the case that needs no record and gets none, so silence here means
 * Construct sounded like itself.
 */
export function voiceOverrideFor(store: Store, run: string): VoiceOverride | null {
  let inForce: VoiceOverride | null = null;
  for (const entry of readWorkLog(store, run)) {
    if (entry.action !== VOICE_OVERRIDE_ACTION) continue;
    const detail = entry.detail as { instruction?: unknown; source?: unknown } | null;
    // An entry whose instruction did not survive is not an override to compose
    // under. Binding an empty voice block would replace the house rules with
    // nothing at all, which is worse than either voice, so a malformed record
    // leaves the house voice standing rather than silently emptying it.
    if (typeof detail?.instruction !== 'string' || detail.instruction.trim() === '') continue;
    inForce = {
      instruction: detail.instruction,
      source: typeof detail.source === 'string' ? detail.source : 'recorded on this run',
    };
  }
  return inForce;
}
