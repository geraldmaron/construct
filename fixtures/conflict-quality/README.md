# The cross-concern conflict, measured

Commitment 11's machinery was measured on the concerns that existed when it was
written. These fixtures measure it on a pair that did not: strategy-alignment,
which argues from what the bet is worth, and system-design, which argues from
what stays reversible. They are the natural pair because their arguments do not
reduce to each other — speed and reversibility are both real and genuinely
oppose — so a run that surfaces only one of them has lost something a reader
needed, not merely been terse.

Each recorded file is a run's observable state: the deliverables its roles
produced, and the inbox decision the kernel framed out of them. Scored by:

```bash
node scripts/check-conflict-quality.mjs --fixture fixtures/conflict-quality/<file>.json
```

## What is scored, and what is not

Scored: both sides declared a stance, each cited its own evidence rather than
the same document read twice, the decision carries both positions and the
reversible default, and nothing in the framing picks a winner.

Not scored: whether either side is right. Whether reversibility should beat
speed on this outcome is the judgment the decision exists to put in front of a
person, and a checker that answered it would be the auto-arbitration
commitment 11 forbids.

## The recorded cases

- `two-sided.json` — the shape the commitment asks for.
- `one-voice.json` — the failure that reads as success: one role declares, the
  other says nothing, and the inbox stays empty because there is nothing to
  frame. A run like this looks clean.
- `same-evidence.json` — both sides cite the same document. Two readings of one
  source is not two concerns disagreeing, and a check that counted citations
  without comparing them would pass it.
- `no-default.json` — both sides framed, no reversible default: the alert-shaped
  failure, where the user is handed back the work they delegated.
