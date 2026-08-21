/**
 * kernel/challenge/rankings.ts — the template slot check for a ranking: a
 * priority order, a roadmap, anything that puts one item ahead of another.
 *
 * The citation gate (verify/claims.ts) already holds a deliverable to this
 * discipline for money, dates, and statutes: a load-bearing claim carries a
 * citation or an explicit tag, never silence. A ranking is a load-bearing
 * claim too, and this project has none yet whose whole deliverable is a
 * ranking — no domain template below declares the slot a roadmap or a
 * prioritization pass would fill. What is buildable ahead of that
 * deliverable existing is the check itself: given the name of the slot a
 * future template puts a ranking in, read what that slot actually says and
 * hold every priority or rank in it to the same two-sided standard readers.ts
 * already applies to an owner attribution — read the named slot, and fall
 * back to the whole deliverable when the template was never headed, so a
 * deliverable that ignores its own template is not held to a looser bar than
 * one that used it.
 */

import { slotSection } from '../plan/ladder.ts';
import { findUngroundedRankings } from '../verify/claims.ts';
import type { ChallengeCheck } from './catalog.ts';

function rankingsGrounded(text: string): ChallengeCheck {
  const ungrounded = findUngroundedRankings(text);
  if (ungrounded.length === 0) {
    return {
      passed: true,
      detail: 'every priority or rank carries a citation or an explicit [assumed] label',
    };
  }
  const shown = ungrounded.slice(0, 3).map((r) => `line ${String(r.line)}`).join(', ');
  const more = ungrounded.length > 3 ? ` (and ${String(ungrounded.length - 3)} more)` : '';
  return {
    passed: false,
    detail:
      `${String(ungrounded.length)} ranking(s) carry neither a citation nor an [assumed] label: ` +
      `${shown}${more}`,
  };
}

/**
 * Whether every ranking in a named slot is bound to cited data ground or an
 * explicit labeled assumption.
 *
 * Reads the slot the same way namesAnOwnerIn does — the template's own
 * heading tells the check which content the ranking question was asked in,
 * which is information a whole-document read cannot recover. A deliverable
 * that never heads the slot falls back to reading itself whole, because the
 * missing slot is already a gap the acquisition ladder raises elsewhere, and
 * this check exists to be stricter than a bare whole-document read, never to
 * be scoped somewhere the deliverable never wrote.
 */
export function rankingsGroundedIn(slotName: string): (deliverable: string) => ChallengeCheck {
  return (deliverable) => {
    const section = slotSection(deliverable, slotName);
    return rankingsGrounded(section ?? deliverable);
  };
}
