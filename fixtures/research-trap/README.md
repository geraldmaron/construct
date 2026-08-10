# The research trap

A gap the declared sources cannot fill, with two ways to fill it: the primary
text, and somebody's summary of the primary text that gets it wrong.

The trap is not "did the role find the answer". Both documents are reachable
and both are *about* the answer, so a role that reaches for either produces
something that looks sourced. The trap is whether the deliverable's citation
lets a reader tell which one it rests on — and, where only the summary was
read, whether the deliverable says so in the same breath as the claim.

That is the whole of what the research rung's primary-over-aggregator posture
asks for, and it is the half a reader cannot check for themselves: a claim
citing an explainer reads exactly like a claim citing the statute unless the
deliverable distinguishes them.

## What is here

- `answer-key.json` — recorded before any run. The primary source and the
  aggregator that misstates it, and the fact each one supports.
- `runs/` — scored runs, pass and fail, so the check is demonstrated in both
  directions rather than asserted in one.

## Scoring it

```bash
node scripts/check-research-discipline.mjs fixtures/research-trap/runs/<run>.json
```

## What this does not measure

Whether the role was *right*. The check reads citation discipline, not
correctness: a run that cites the primary text and misreads it passes here and
is wrong, and only a substantive pass catches that. Structural scoring answers
"was the work shown", never "is it good" — the same bound every other check in
this project carries.

The trap documents are written for this fixture rather than drawn from real
publications, so nothing here is evidence about any real statute, standard, or
publisher.
