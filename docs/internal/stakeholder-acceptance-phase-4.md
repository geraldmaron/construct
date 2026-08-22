# Phase 4 stakeholder acceptance: what to check

> **Updated 2026-08-06, after the fixes.** The first reading of this packet
> was "everything failed" — which was the packet doing its job: the runs
> below were recorded to surface defects, and they did. Since that reading,
> the defects have been worked and `3.0.0-alpha.3` shipped with the fixes.
> Where each one stands:
>
> - **The fabricated provenance (case 1, `construct-kl4`) is FIXED and
>   released.** Citations naming Construct's own scaffolding (`[domain
>   catalog]`, `[source: domain catalog — …]`, `CITE: domain catalog`) now
>   fail the citation challenge. Validated against these exact deliverables:
>   the rule flags the three that invented provenance and passes the two that
>   cited honestly. A re-run of case 1 would hold those deliverables at
>   `challenged` instead of promoting them.
> - **The dropped log reasons (`construct-bay`) are FIXED and released.**
>   `construct log` now prints the recorded reason on every failure and
>   degradation entry, so `namer-failed` reads with its cause and fallback.
> - **The namer capability floor (`construct-3w9`) is RECORDED and closed.**
>   `fixtures/model-floors/` holds dated per-model results: the 4b fails the
>   namer contract even with the new one-shot corrective retry (also shipped),
>   while 35b, gpt-oss:20b, and three hosted free models hold it clean. The
>   floor is a fact about the model, and it is now written down.
> - **Case 2's keyword silence is the designed ceiling, not a regression.**
>   The zero-model fallback cannot reach vocabulary nobody listed; the routing
>   inversion exists because of that, and case 3 shows the same sentence
>   answered correctly by a model that holds the namer contract. The fix for a
>   user on a too-small model is the recorded floor plus the retry — and the
>   honest miss statement, which case 2 shows working.
> - **The open-weight depth gap (`construct-fdl`) is MEASURED, not fixed.**
>   qwen3.6:35b (and now nemotron-3-super:free) fail the depth harness while
>   holding the JSON contracts, so both stay best-effort. That is the model
>   matrix telling the truth; docs/model-family-promotion.md is the written
>   path up.
> - **Two new defects the follow-up judging surfaced are FILED:**
>   `construct-8yi` (a role quoting the namer's inferred framing as the user's
>   outcome) and `construct-z34` (the best-effort label and an owner per issue
>   must reach the deliverable body). The judging record is
>   `fixtures/persona-acceptance/2026-08-06-panel-claude.md`: four of five
>   deliverables rejected, and invented provenance — now refused — decided
>   every rejection; the fifth (35b compliance) passed the Compliance rubric
>   as-is.
>
> What remains yours: the verdicts below (still deliberately unrecorded), and
> acceptance of this packet, which closes the Phase 4 exit.

This is the packet that replaces the external-tester gate. Gerald reads it, checks
the outcomes himself, and accepts or rejects. Every run named here was executed
through the shipped CLI on this machine; nothing in it was produced by a script
written for the occasion.

## What this gate licenses, and what it does not

It licenses one thing: that the surface did what is recorded here, on the
outcomes recorded here. It licenses **nothing about anyone other than the
author** — no success rate across users, no claim that the surface is learnable
by someone who did not build it. The sampling design that would have supported
such a claim is withdrawn (`STRATEGY.md` Phase 5, `RESEARCH-DECISIONS.md` §9),
because this program spends no external subjects.

What keeps the measured claims elsewhere in the project honest is unaffected by
who reads this packet: the labeled corpora were authored by minds that never saw
the domain catalog, the org-harness answer key is committed before any run and
never edited to fit one, and harness scoring is structural rather than
judgmental. **Stakeholder acceptance sits on top of that evidence and is never
itself cited as a measurement.**

## How these runs were produced

Free by design, so re-verification costs nothing and no dispatch spends money:
every run goes through a local model served by Ollama, reached through the
pinned OpenCode host adapter.

```bash
construct outcome --host=opencode --model=ollama/<model> --binary=/opt/homebrew/bin/opencode "<outcome>"
construct work    --run <run-id> --host=opencode --model=ollama/<model> --binary=/opt/homebrew/bin/opencode
construct show    --run <run-id>
construct log     --run <run-id>
```

Two honesty notes about the host, both of which matter when reading the
deliverables below:

- **The local families are untuned.** `src/hosts/tuning.ts` records the Claude
  family as the only tuned entry; every dispatch here therefore writes a
  `model-untuned-best-effort` degradation note to the work log. Deliverable
  depth on these runs is not the depth measured for the tuned family, and must
  not be read as it. The tuned-family depth evidence lives in
  `fixtures/org-harness/runs/`, scored against a pre-committed answer key.
- **Cost of zero here means unmeasured, not free in general.** Local runs emit
  no usage accounting, so a summed cost of 0 is a well-formed zero rather than
  evidence about what a paid host would charge.

Runs were executed from a scratch project directory, not the repository, so
nothing here mutated the repo's own configuration.

## The cases

Composition follows the Phase 2 stratification rule in spirit: not all
engineering, and at least one case a careful person would read as touching laws
or rules.

### Case 1 — "We want to hire a contractor in Poland to help with support"

`run-20260806032817359`, on `ollama/qwen3.5:4b`.

Read it with:

```bash
construct show --run run-20260806032817359
construct log  --run run-20260806032817359
```

What happened, in order. The model-primary namer **failed** — the host returned
malformed JSON — so the keyword map answered instead, which the run said on
screen and recorded as a `namer-failed` entry. It implicated `employment`
(signals: contractor, contractors, hire) and `contracts` (signal: contract),
queued two tasks, and both completed. Every deliverable carries the
licensed-review qualifier on the same screen as its text. The spend footer reads
`0 of 10.00 ceiling` followed by "2 task(s) ran on a host that reported no cost.
The ceiling did not bind on those" — a zero that says it is unmeasured rather
than claiming the work was free. The decision inbox is empty, and says so.

Both deliverables sit at `draft`, which is correct: `legal-issue-spot` has no
structural check, so it is recorded unanswered rather than passed, and nothing
promotes on the strength of the checks that happened to be cheap.

The `employment` deliverable is the better of the two and worth your eye: it
names contractor misclassification, Polish social-security exposure, GDPR, and
four open questions each marked `[assumed: …]`. The `contracts` deliverable
declined the work — `STANCE: hold`, because no contract text was supplied — which
is defensible for that lens and still probably not what a person asking this
question wanted. Whether that is the lens's framing or the small model's
literalism is a judgment I would rather you make than make for you.

Two defects came out of this case, both filed:

- **`construct-kl4` (P1).** The `employment` role cited `[domain catalog]` as the
  evidence for Polish labor law and the GDPR penalty ceiling. The catalog
  contains a domain name, a one-line concern, and a keyword list — none of it.
  The facts are roughly right and the provenance is invented, which is the worse
  combination, and it passed the citation challenge because that check refuses
  source *paths* and this is not a path.
- **`construct-3w9` (P3).** The namer cannot hold its JSON contract on a 4b-class
  model. The fallback behaved exactly as designed; what is missing is a recorded
  capability floor, so nobody has to pay a model call to discover it.

### Case 2 — "We want to start recording our customer support calls and use them to train a support assistant"

`run-20260806035130873`, on `ollama/qwen3.5:4b`. **This is the case I would check
first, because it implicated nothing at all.**

The namer failed on malformed JSON again, and this time the keyword map was
silent too, so the run named no domains and queued no work. It said exactly
that: *"no domains implicated. opencode could not be consulted (the host replied
with malformed JSON) and the keyword map is silent too — this is recorded, not
silently dropped."*

The silence is honest and complete, and it is still a total miss. Recording
customer calls is a consent question in most jurisdictions, and training a model
on those recordings adds a purpose-limitation question on top; a person asking
this deserves to hear `privacy` at minimum, plausibly `compliance` and
`security` as well. Nothing in the catalog's vocabulary reaches the sentence — I
checked every keyword in the catalog against it and not one matches. `privacy`
lists `customer data`, `consent`, `personal data`, `gdpr`; the sentence says
`customer support calls`, `recording`, `train`. This is the structural ceiling
`STRATEGY.md` risk 1 already names — a miss closes with a word nobody listed —
and it is why the routing inversion put a host model in front of the keyword map
rather than tuning more keywords into it.

So this case is really a measurement of the fallback, not of the product's
primary path, and the honest way to read it is against the same sentence run
through a namer that can hold its output contract. That comparison is below.

**This is the case where `--missed` earns its keep:**

```bash
construct verdict --run run-20260806035130873 --missed=privacy
```

### Case 3 — the same sentence, through a namer that holds its contract

`run-20260806040351750`, on `ollama/qwen3.6:35b`. Identical outcome text to
case 2.

The 35b model held the JSON contract and named three domains, each with its
stated reason recorded as evidence:

- `privacy` — recording captures personal data and requires caller consent
- `security` — the recordings must be protected; a breach exposes private
  conversations
- `compliance` — call recording is governed by one-party/all-party consent law
  and data-protection rules on collection, storage, and use

The run says these came from a model reading the outcome, not the keyword map.
Three tasks were queued and all three completed on the same model (`done ·
draft`, correctly held at draft for the same reason as case 1). The compliance
deliverable is worth reading in full: it maps one-party/all-party consent,
GDPR purpose limitation, CCPA notice, and the new system identity the training
pipeline introduces, with every ungrounded claim tagged `[unverified]` or
`[assumed]`. Read the deliverables with:

```bash
construct show --run run-20260806040351750
```

Cases 2 and 3 together are the routing inversion's argument in miniature, on
one sentence: the keyword map's silence is structural (no listed word appears),
and a model reading the same words names the concerns a careful person would.
They also bound the namer's capability floor from both sides — 4b cannot hold
the output contract, 35b can — which is exactly what `construct-3w9` asks to be
recorded rather than rediscovered per run.

## The verdicts are deliberately not recorded

No `construct verdict` was run on any of these runs, and that omission is the
point. A verdict is a label, and the routing corpus is where labels go. A label
recorded by the same session that produced the run shares an author with the
system it measures, which is the one thing the corpus rule forbids — it would
manufacture agreement and quietly poison the only unspent human-labeled data the
project can still get.

So the verdicts are yours. For each case below:

```bash
construct verdict --run <run-id>                                  # what surfaced
construct verdict --run <run-id> --confirm=<domain> --dismiss=<domain>
construct verdict --run <run-id> --missed=<domain>                # the one that should have come up
```

`--missed` is the most valuable of the three, because a system cannot notice its
own silence. These verdicts are also the only path to the one measurement left
open in the decision-science pass: whether the model-coder labeling proxy tracks
your judgment (tracked as `construct-3ft`, which is gated on exactly this data
existing).

## What I would look at first

1. **Case 2's silence, then case 3's answer to it.** One sentence, no domains
   versus three with evidence. If you dismiss `security` or `compliance` on
   case 3 as over-reach, that verdict is as valuable as the confirms.
2. **The fabricated provenance in case 1** (`construct-kl4`, P1). The
   employment deliverable reads well and cites an artifact that does not
   contain what it cites. This is the one finding I would not ship another
   alpha without fixing, because the citation is the unit of trust.
3. **The `contracts` hold in case 1.** Defensible lens behavior or a surface
   that sent a person away empty-handed — your call, and it shapes whether
   dispatch should tell a role "no source material" is an expected state
   rather than a reason to decline.

## The findings, as beads

| Bead | Priority | What it records | Status (2026-08-06) |
|---|---|---|---|
| `construct-kl4` | P1 | Citations naming Construct-internal scaffolding pass the citation check while inventing provenance | **Fixed, released in alpha.3** |
| `construct-bay` | P2 | `construct log` drops the recorded reason on `namer-failed` and other degradation entries | **Fixed, released in alpha.3** |
| `construct-3w9` | P3 | The namer's capability floor (4b fails the contract, 35b holds it) should be recorded, not rediscovered | **Recorded in `fixtures/model-floors/`, closed** |
| `construct-fdl` | P3 | The open-weight family, measured on the dispatch shape: improved, still not a pass; stays best-effort | Measured; stays best-effort by design |
| `construct-8yi` | P2 | A role quotes the namer's inferred framing as the user's outcome (`[cite:outcome brief]`) | Open, filed from the persona panel |
| `construct-z34` | P2 | The best-effort label and an owner per issue must reach the deliverable body | Open, filed from the persona panel |

Acceptance of this packet closes `construct-9xq` and, with it, the Phase 4
exit. It does not close the beads above; they are the follow-up work the runs
exist to surface.
