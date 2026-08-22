# adversarial-review — recorded run 2 (2026-08-21, Sonnet tier)

Run conditions: Sonnet-tier reviewing agent, skill file outside the
repository as its only method reference, repository forbidden, no web. The
artifact under review was real and about to be handed to the decider: the
draft agentic-platform strategy (docs/internal/agentic-platform-strategy.md).
Reviewer and author share a model family; the review's own self-review
gate discloses this and names the shared blind spots it implies. The
deliverable below is verbatim as produced; nothing was edited.

The one-line verdict for the use ledger: accepted with controls — three
serious findings, all of which changed the shipped document. (1) The
ledger — the strategy's central evidence — was asserted without its n=10
self-scored caveat; the caveat is now in the document's own text. (2) The
skills-format multi-vendor claim was the weakest-sourced load-bearing
claim and conflicted in tense with the document's own revisit trigger; it
is downgraded to its supported strength and the conflict reconciled.
(3) The hedge's cost estimate depended on an unstated scope question
(already-built vs. new work); the scope is now explicit with a re-cost
rule. Two minor findings (the non-enterprise productization path omitted
from the options; hedge-document staleness outside the named control)
were also applied. The review additionally surfaced the
trigger-detection-latency failure mode the draft's own pre-mortem missed,
now addressed by assigning the revisit triggers a checking cadence.

Producing model: Sonnet (same family as the strategy's author; the
correlated-error caveat is disclosed inside the review itself).

---

**Verdict: Accepted with controls**

## Steelman

The document does the hard part of strategy honestly: it separates the layers that have commoditized from the one that plausibly hasn't, names its own strongest counter-argument and refuses to file it away, ties its "what would change the answer" triggers to externally observable events rather than internal mood, and proposes the cheapest possible hedge against the one live threat (governance/provenance closing) rather than betting the whole program on it. For a solo operator under hard, named constraints (no runtime, no cross-user claims, dogfood-only legal), "keep doing the thing with evidence behind it, cheaply option the alternative" is a defensible, low-regret shape of answer — on its own terms, before the claims underneath it are audited.

## The six challenges

**1. Strongest failure mode — run.**
Concrete story: an incumbent (plausibly Anthropic or OpenAI itself, since OpenAI's own "coming soon" language is cited as the trigger) ships a bundled work-product audit within two quarters. Per the document's own trigger ("drop the hedge to documentation"), construct is supposed to notice and stand down the governance option. But nothing in the document specifies a monitoring cadence — the landscape evidence comes from a periodic "investigative-research run" (dated `2026-08-21`), not a standing watch. A solo operator whose bandwidth the document itself calls "the ledger's scarce input" plausibly does not re-run that research for a quarter or two. By the time it's noticed, the option the hedge exists to protect is already gone, and nobody knew in real time — the exact "silent and expensive" failure the assumption-inversion challenge (below) is built to catch. The pre-mortem names a related failure (bandwidth splitting into three jobs) but not this one (the trigger-detection latency itself).

**2. Best alternative not chosen — run.**
The three alternatives (governance pivot, platform play, ungated drift) are real, and governance pivot is argued and rejected on genuine grounds (procurement inertia, the no-cross-user-claims constraint, evidence residing in method not governance). But the rejection is built entirely around an *enterprise* framing of governance work. A middle option is missing: productizing the measurement discipline itself — the pre-registered falsification, the naked-file tests, the ledger — as a small, non-enterprise offering aimed at other solo/small AI builders, which would sidestep both objections used to kill the governance pivot (no enterprise procurement cycle needed, no cross-user claim required if the "product" is the methodology/tooling rather than a claim about outcomes on someone else's agents). The document's "options, honestly generated" claim is weakened by this omission — it's honest about the options it generated, not obviously exhaustive.

**3. Load-bearing-claims audit — run.**
- *"Ten gate-changed outcomes in ten rows"* [seen: ran, program's own ledger] — cited flatly as evidence, no caveat anywhere in the artifact about sample size, self-scoring, or whether non-hits are logged as rows at all. This is the single claim the recommendation's differentiation argument rests on ("the program's proven asset"), and it is unaudited in the document itself.
- *"Agent Skills SKILL.md format is read by Microsoft, OpenAI, Google, JetBrains, AWS, and Block"* [research: landscape run §1] — sourced only as "convergent multi-source reporting," no primary citation, unlike the adjacent MCP/Linux-Foundation claim in the same paragraph which does cite a primary announcement. The asymmetry is itself a tell: the more surprising, more load-bearing claim has the weaker sourcing.
- *"No flagship carries a deliverable-challenge skill"* [cite: ecosystem survey run 3] — the absence-claim that anchors finding 3 (construct's method niche is unoccupied) is produced by the same program whose niche claim it supports; no outside check is named.
- *"Solo operator... cannot run enterprise sales"* — asserted to disqualify the governance pivot, not demonstrated (no attempt, no market test, no named reason beyond bandwidth).

**4. Assumption inversion — run.**
- Invert "the governance window stays open long enough to exercise": covered above (finding 1) — the trigger-detection mechanism is unspecified, so the failure would be silent.
- Invert "the ledger's next ten rows will continue to validate the method": the document's own revisit trigger requires waiting for a *full second batch of ten* to trend toward refutation before reopening the decision — for a landscape the document itself says moves in quarters, that is a slow tripwire. Early degradation in rows 11–13 would not, by the letter of the trigger, reopen anything.
- Invert "skills remain freely copyable without threatening the moat": if the differentiator is the *process* (pre-registered falsification, verification records, ledgers) rather than the files, and that process is described in public methodology (including the very skill file this review is run under, which cites its own intellectual lineage — Heuer, Klein, ICD 203), a resourced copier reading the same public sources could replicate the process, not just fork the repo. "Cannot be copied by forking a repo" is true and beside the point; the document doesn't address copying the *method*.

**5. Who bears the cost — run, mostly clean.**
Decider and cost-bearer are the same party (Gerald, solo) — the case the skill flags as a red flag (costs landing on someone absent from the room) does not apply here in the usual sense, and the document is honest about this being unhedgeable, irrecoverable solo time. One minor version survives: *future* Gerald inherits a stale hedge document or an abandoned-but-uncanceled governance option approved by *present* Gerald — a temporal rather than interpersonal version of the absent-party pattern. The pre-mortem's control (ledger row count joins the reconciliation ritual) partially catches this but is scoped to the ledger, not to the hedge document's own staleness.

**6. Five-minute hostile expert — run.**
The first thing a platform-strategy expert would check is the SKILL.md multi-vendor claim (finding 3), because it's the most surprising and most checkable line in the document. On inspection it also self-conflicts with the document's own "what would change the answer" section, which treats "the Agent Skills format's governance moves to a foundation the way MCP's did" as a *future*, uncertain trigger — while finding 2 already asserts, in the present tense, that the major vendors "read" the format today. Either the format is already converged on (weakening the "future trigger" framing and the urgency of the hedge) or it isn't yet (weakening finding 2's "in construct's favor" claim right now). The document doesn't distinguish "vendors can technically parse a markdown+frontmatter file" (trivially true, not a strategic finding) from "vendors have adopted it as a first-class extensibility contract" (the actual claim needed, unsupported).

## Findings

```
1. The program's central differentiator (the ledger) is asserted, not audited, inside the artifact [severity: serious]
   Failure: quarters of solo time are committed on the strength of an n=10, self-scored,
   single-program result with no stated criteria for what counts as a row and no external
   check; if the sample is unrepresentative (selection effects, undisclosed misses), the
   recommendation's foundation is weaker than the document lets the decider see.
   Evidence: "Seven validated method skills... a use ledger at ten gate-changed outcomes in
   ten rows — [seen: ran, this program's own ledger and runs]" carries no caveat anywhere in
   the artifact; the small-n/self-produced caveat exists only in the requester's framing of
   this review, not in the document itself.
   Smallest fix: add one sentence in the map section stating sample size, scoring method
   (self vs. external), and whether non-hits are counted as rows, so the decider sees the
   same limitation the review had to be told about separately.

2. The SKILL.md multi-vendor adoption claim is the weakest-sourced load-bearing empirical
   claim in the document, and it self-conflicts with the document's own future-trigger
   language [severity: serious]
   Failure: finding 2 ("interface layer... in construct's favor") leans on this claim to
   argue the distribution ground is already firm; if "read by" means only technical
   parsing rather than adopted-as-contract, the interface-layer argument is weaker than
   claimed, and the recommendation's confidence in "construct already speaks the winning
   format" is overstated.
   Evidence: cited only as "convergent multi-source reporting" with no primary source,
   unlike the adjacent MCP/Linux Foundation claim in the same paragraph which cites "primary
   announcement, read"; contradicted in tense by "the Agent Skills format's governance moves
   to a foundation the way MCP's did" being listed as a future, uncertain trigger later in
   the same document.
   Smallest fix: either attach a primary citation per named vendor or downgrade the claim's
   verb from "read" to something that matches what was actually verified, and reconcile the
   tense conflict with the revisit-trigger section.

3. The hedge's scope is internally ambiguous between "already built, just document it" and
   "new work" — and the cost estimate that dominates the "ungated drift" option depends on
   which it is [severity: serious]
   Failure: the map section already claims the kernel "project[s] over MCP as
   presence-not-execution" as an existing, ran capability, while the decision section
   proposes "project the kernel's provenance surface outward now (MCP, documented, dated)"
   as new action with a cost of "a documentation pass." If the capability isn't actually
   built yet, the true cost is engineering work, not documentation — which is exactly the
   "three jobs, bandwidth spread" failure the pre-mortem names as the likeliest way this
   recommendation fails, undercutting the recommendation's own stated confidence that
   "the hedge is small."
   Evidence: "A kernel doing coverage, obligation, and provenance with an append-only work
   log, projecting over MCP as presence-not-execution — [seen: read/ran, this repo]" versus
   "Add the hedge: document and date the kernel's provenance/obligation surface as an
   MCP-reachable capability... Cost: the hedge is small."
   Smallest fix: one clause stating whether the MCP provenance surface is already live
   (hedge = dated announcement doc) or not (hedge = build + document), with cost re-stated
   accordingly.

4. Alternatives are framed as enterprise-governance-or-nothing, omitting a non-enterprise
   productization path that would dodge the objections used to reject governance pivot
   [severity: minor]
   Failure: none fatal to the current recommendation, but "options, honestly generated"
   is weaker than claimed — a reader could reasonably ask why a smaller governance/
   provenance offering aimed at peers (not enterprises) wasn't considered before the
   governance option was rejected on enterprise-specific grounds.
   Evidence: governance pivot's rejection cites "enterprise procurement favors bundled
   incumbents" and "a solo operator... cannot run enterprise sales" — both scoped to
   enterprise sales specifically, with no non-enterprise variant considered.
   Smallest fix: add one sentence acknowledging the non-enterprise productization path and
   why it's out of scope for this decision cycle (bandwidth, focus), if that's the real
   reason.

5. Future-Gerald inherits a stale hedge/abandoned option approved by present-Gerald
   [severity: minor]
   Failure: a mild, temporal version of the "cost lands on someone absent from the room"
   pattern — the reconciliation-ritual control catches ledger stalls but not hedge-document
   staleness specifically.
   Evidence: pre-mortem's named control covers "the ledger's row count," not the hedge
   document's own freshness against the trigger events that are supposed to retire it.
   Smallest fix: fold "hedge document last-reviewed date vs. revisit triggers" into the same
   reconciliation check already proposed for the ledger.
```

## What didn't break

Reversibility framing, the do-nothing baseline, the disqualification of the platform-play option (a standing commitment, not a judgment call), and the who-bears-the-cost picture are sound as stated — I did not find a way to break them, and say so rather than padding.

## Verification record

```
Verification record
- Steelman stated:      answered — see Steelman
- All six run:          answered — findings from: 1 (failure mode), 3 (claims audit),
                        4 (assumption inversion), 6 (hostile expert); clean: 5 (cost),
                        mostly clean with one minor: 2 (alternatives)
- Findings concrete:    answered — 5 findings: 0 fatal, 3 serious, 2 minor
- One verdict:          answered — accepted with controls
- Self-review:          answered — shared-context, disclosed: this review is produced by
                        the same model family (Claude) as the artifact's author, per the
                        requester's own framing; treat this as a review that shares the
                        author's plausible blind spots (e.g., toward the SKILL.md-adoption
                        and ledger-strength claims), not an independent check
- No improvement drift: answered — breakage only; controls listed are the smallest fixes
                        that retire each finding, not a redesign
```

Controls required for acceptance: (1) the ledger's sample-size/scoring caveat is stated in the artifact itself, not left to side-channel context; (2) the SKILL.md multi-vendor claim is either sourced per-vendor or downgraded, and its tense conflict with the revisit-trigger section is resolved; (3) the hedge's actual scope (already-built vs. new work) is stated explicitly, with cost re-estimated if it's the latter. None of these change the recommendation's direction — they change how much confidence the decider should place in the two pillars (the ledger, the interface-layer claim) currently presented as settled evidence.
