# What the keyword shape chooser reaches, measured (2026-08-21)

`shapeForOutcome` in `src/kernel/run/shapes.ts` picks which document a run
produces when no model is available to be asked. Measured against forty asks
written by an author who had never read it, it picks the shape the person meant
**0.375** of the time: **miss 0.625 (25/40, 95% CI [0.470, 0.758])**.

The rate is not the finding. The finding is underneath it: the phrase lists fire
on **0.200 (8/40, 95% CI [0.105, 0.348])** of asks, and when they fire they are
right 7 times in 8. The other **0.800 (32/40, 95% CI [0.652, 0.895])** match
nothing at all and are answered with the default shape — which is `review`, a
real shape with a real meaning. The chooser has no way to say "nothing matched,"
so it says "review" instead, and a caller cannot tell the two apart.

**Verdict: the inversion this measurement was meant to justify is already
shipped, so nothing is built. What the figures do warrant is narrower — the
fallback must be able to report that it matched nothing.** Both are argued at
the end.

Regenerate every figure here with:

```bash
node scripts/measure-shape-chooser.mjs
```

## What was measured, and what was not

`shapeForOutcome` is no longer the primary chooser and has not been since
`6f18b4a6`. With a host named, `construct compose` asks the model which shape the
ask wants, prints `shape: <name> (chosen by the model)`, and accepts `--shape` as
an override — the same model-primary ordering the routing work adopted on the
`RESEARCH-DECISIONS.md` §10 figures. The keyword chooser holds one live duty: it
answers when that model call fails or returns a name that is not a shape.

So this measures the fallback, on the occasions the fallback fires. That is worth
measuring precisely because it is a fallback: it runs at the moment something
else has already gone wrong, when nobody is watching it closely, and its answer
is presented to the reader in the same register as a model's.

## The corpus

`tests/kernel/run/fixtures/shape-asks.json` — forty asks, eight per shape, across
forty unrelated settings (hospital float pools, grain co-ops, port terminals,
broadcast post, a food bank).

**Authored blind.** The author was given the five shape names and one
plain-language sentence describing each, and nothing else: no keyword list, no
catalog entry, no source file, no other corpus, no access to this repository. It
made **zero tool calls** producing the forty, so the blindness is a property of
the transcript rather than an instruction that was trusted to have been followed.

Twenty-two of the forty (0.550) deliberately avoid their shape's own genre word —
an ask that means *write this decision down permanently* without containing "ADR"
or "decision record." That half is the corpus's whole purpose. A matcher keyed to
genre words is trivially right when the genre word is present, and the question
that matters is what happens when a real person does not happen to say it.

**Labels.** The primary label is the author's own intent: it wrote each ask in
order to mean that shape, so the label is not a later reading of ambiguous text.
A second coder then labeled all forty from the ask text alone, seeing the same
five one-line definitions and neither the author's labels nor this repository. It
agreed on **40 of 40** — disagreement 0.000 (0/40, 95% CI [0.000, 0.088]).

That interval is the annotation floor for this corpus, and it settles the
question §2 of `RESEARCH-DECISIONS.md` raises about the role catalog: a measured
miss of 0.625 cannot be explained by ground truth contradicting itself, because
the ground truth does not contradict itself anywhere in these forty. The gap is
the matcher.

**The caveat travels with every number here.** Author, second coder and the prose
of this repository are models of one family, so observed agreement is an upper
bound on independent agreement. Blindness buys independence of *wording*, not
independence of *error* — and wording is exactly what a keyword matcher is scored
on, which is why it is the right thing to buy here.

## Method

One rate, not two. Domain inference is multi-label, so §1 quotes a miss rate and
an over rate that move independently. A shape pick is single-label: exactly one
shape comes back, always. There is one error rate, and quoting a second would be
inventing a number. A "miss" is the chooser returning a shape name other than the
label.

All intervals are Wilson 95%, from `src/kernel/metrics/intervals.ts`, per the
project's reporting rule. At n = 8 per shape they are very wide, and the per-shape
rows below should be read as direction rather than as measurement.

## The figures

Run of 2026-08-21, recorded per ask in `fixtures/shape-chooser/keywords.json`.

| cut | miss |
|---|---|
| **all forty** | **0.625 (25/40) — CI [0.470, 0.758]** |
| names its genre word (18) | 0.500 (9/18) — CI [0.290, 0.710] |
| avoids its genre word (22) | 0.727 (16/22) — CI [0.518, 0.868] |

| how the answer was reached | rate |
|---|---|
| a phrase matched | 0.200 (8/40) — CI [0.105, 0.348] |
| nothing matched, default answered | 0.800 (32/40) — CI [0.652, 0.895] |
| wrong **given** that a phrase matched | 0.125 (1/8) — CI [0.022, 0.471] |

| intended shape | miss |
|---|---|
| review | 0.000 (0/8) — CI [0.000, 0.324] |
| decision | 0.750 (6/8) — CI [0.409, 0.929] |
| spec | 1.000 (8/8) — CI [0.676, 1.000] |
| rfc | 0.625 (5/8) — CI [0.306, 0.863] |
| adr | 0.750 (6/8) — CI [0.409, 0.929] |

Where the misses went: `spec -> review` 8, `adr -> review` 6,
`decision -> review` 6, `rfc -> review` 4, `rfc -> decision` 1.

## Reading

**The review row is not a success.** `review` is the default shape and carries no
phrase list of its own, so it is the one answer reachable without matching
anything. All eight review asks scored correct by falling through, exactly as the
twenty-four non-review misses did. The chooser did not recognize a single review;
it failed to recognize twenty-four other things and was standing on the right
square eight times. Read that row as 0.000 and you have read a coin landing
heads as marksmanship.

**Twenty-four of the twenty-five misses are silence wearing a shape's name.**
Only one miss (`rfc -> decision`, ask 20) is the matcher firing and choosing
wrongly — "go/no-go at each step" hit a decision phrase in an ask that was plainly
circulating a proposal for comment. Every other miss is the phrase lists declining
to fire. This is the same failure the nanobot host trial recorded against the
role map, where a question written in the user's own vocabulary reached neither
router and the keyword map named nothing at all. There it was visible as silence.
Here it is worse than silence, because the fall-through has a name that reads
like an answer.

**The phrase lists are precise and brittle in the same breath.** Given that a
phrase fired, the pick was right 0.875 (7/8, 95% CI [0.529, 0.978]). The lists
are not badly chosen; they are simply narrow, and narrow in ways no writer would
predict. Each of these flips on one word, verified directly:

| the ask as written | picked | one word changed | picked |
|---|---|---|---|
| "Write **the** spec for the bus routing tool" | review | "Write **a** spec for …" | spec |
| "**PRD for** mobile remote deposit capture" | review | "**A PRD for** …" | spec |
| "**ADR:** provisioning services talk gRPC" | review | "**ADR for** provisioning services …" | adr |
| "**Draft** the requirements for the FNOL redesign" | review | "**Write** the requirements for …" | spec |
| "**Functional** spec for the alerting service" | review | "**A** spec for …" | spec |

The article, the colon, and the choice between *draft* and *write* are all
invisible to the person typing. Three asks in the corpus name their genre
outright — "Write the spec for", "PRD for", "Functional spec for" — and all three
were answered `review`, which is why the spec row reads 1.000.

**The genre-word split does not establish what it looks like it establishes.**
0.500 with the genre word against 0.727 without looks like the expected story,
but the intervals overlap substantially ([0.290, 0.710] against [0.518, 0.868])
and this corpus cannot separate them. What it can say is that both halves are far
above any rate that would make the chooser usable on its own, and that naming the
genre word plainly is not sufficient protection.

**It lands where the role map landed.** §1's `unspent` row puts the keyword role
map at miss 0.663 (55/83, CI [0.556, 0.755]) on blind wording. This chooser sits
at 0.625 (CI [0.470, 0.758]) on blind wording, intervals almost entirely
overlapping. Two independently written phrase matchers, two independently
authored blind corpora, the same answer. That is the strongest thing in this
document, and it is not a fact about either list of phrases.

## The verdict

**The contemplated adoption is moot: it already shipped.** The change this
measurement was meant to justify — a host model proposing the shape, printed and
overridable, the keyword map demoted to fallback — is `6f18b4a6`, already on
`main`. Building it again would add a second variant of a pattern the codebase
already has. The figures above are therefore best read as *retrospective
justification for a change already made*, and they justify it comfortably: the
thing that was demoted deserved demoting.

**What the figures do warrant is narrower, and it is about disclosure.** The
fallback currently prints `shape: review (the model could not be asked; falling
back to the keyword guess)`. That sentence is honest about *who* chose and silent
about *whether anything matched* — and the measurement says that 0.800 of the
time, nothing did. A reader cannot act on that message, because the same words
appear when the guess is a genuine phrase match and when it is a default standing
in for silence.

The kernel already draws this exact distinction one layer over. `naming.ts`
reports `inferredBy: 'keywords'` when the map actually matched something and
`'none'` when it did not, precisely so a caller can tell a considered answer from
an empty one. The shape fallback should carry the same distinction, for the same
reason, and by mirroring that pattern rather than inventing a second one.

**What is deliberately not done.**

- *No keyword tuning.* Adding "write the spec for", "prd for", "adr:" and the
  rest would move this corpus's numbers and teach the matcher nothing. It is the
  instrument tuned to the one case somebody looked at — the failure §1 records
  happening twice already, where a corpus stops being held out the moment it is
  tuned against. The brittleness table above is evidence about the *approach*,
  not a list of patches.
- *No threshold test.* Nothing in the harness asserts a passing rate, and nothing
  should. A corpus that gates a build is a corpus the next change is tuned
  against; this one is worth more as a fact to watch than as a bar to clear. The
  same rule `fresh-outcomes.json` states about itself.
- *No claim that the model path is better on shapes.* It is measured for roles
  (§10) and merely assumed here. This corpus scores one arm only. Running the
  model arm over these same forty is the obvious next measurement, and until
  somebody pays for it, "the model does better at picking shapes" is a reasonable
  expectation and not a finding.

## What this does not decide

Forty asks, one blind author, one second coder, one model family. The per-shape
rows are eight observations each and are direction only. The corpus is spent by
being published: from here on the matcher can be tuned against it, and passing it
proves progressively less.
