# adversarial-review — recorded run 3 (2026-08-21, Sonnet tier)

Run conditions: Sonnet-tier reviewing agent, skill file outside the
repository as its only method reference, repository forbidden, no web. The
artifact under review was the suite's entire template set — every output
shape the seven skills mandate — with the assignment to challenge
soundness, the record-block pattern itself, coverage, and formatting DNA.
The reviewer was independent (did not author the suite). The deliverable
below is verbatim as produced; nothing was edited.

The one-line verdict for the use ledger: accepted with controls — six
findings, every one applied to the suite the same day. The central catch
was compositional, not individual: N co-firing skills stacked N full
verification records onto one deliverable (the wall-of-text outcome the
templates exist to prevent), resolved by the collapse rule now carried in
every skill's record section and in AUTHORING.md. The presence-not-quality
exploit (a vacuous "answered — see X" indistinguishable from a real one)
is closed by requiring pointers to quote a fragment of their target. The
coverage gap the hostile-expert challenge found first — no shape for the
operator's two highest-frequency artifacts, the small decision log entry
and the handoff — is filled with two new written-voice genres. Minor
findings (the PRD risk-stub disguise, the evidence-tag gap for
self-testimony, verdict lines hiding inside uniform record formatting)
were each applied at their single source.

Dispositions of the remaining coverage rankings, for the record:
research synthesis stays a MEDIUM candidate in the flat deliverable
layer; status report was correctly found already covered; incident
postmortem is recorded as an overlap risk with tooling the operator
already holds, not a gap; presentation outline and long-form email stay
LOW, unfiled.

Producing model: Sonnet (same family as the suite's author; the
correlated-error caveat travels with any same-family judged reading).

---

Verdict: **Accepted with controls**

The template set is sound in its core mechanics — the record blocks, the labeled-field discipline, the closed-vocabulary shapes are genuinely more scannable than default prose — but it breaks in exactly the place the requester is worried about: composition. Nothing in any of the seven files says what happens when more than one skill's mandatory verification record lands on the same page, and for a solo operator whose real deliverables routinely trigger two or three skills at once, that gap is where "reads human" quietly loses to "reads like a form." Three controls close it; none require redesigning a template.

## Steelman

Each of the seven templates, read alone, does what it claims: a reader can tell in seconds whether a gate was answered and where, the closed vocabularies (relationship types, evidence tags, citation markers) prevent the specific lies structure is prone to (untyped arrows, invented citations, hedged verdicts), and every skill is honest in the same place — "the record is presence, not quality" — so no template overclaims what it enforces. For a weak model with no judgment to fall back on, a literal skeleton that forces "Outcome," "Non-goals," and "Acceptance" into existence is strictly better than a blank page, and that is the design's actual target population.

## 1. Strongest failure mode

A solo operator writes a one-page vendor decision (costly-to-reverse) that he'll forward to his accountant. He runs intake (parses his own brain dump), decision-framing (the choice), written-voice's Proposal shape (the audience), and adversarial-review (load-bearing, before committing) — all four legitimately in scope per their own stand-down rules. The result: roughly 350 words of actual decision content, correctly fronted by the recommendation (written-voice §3's own rule), followed by **four** "Verification record" blocks — Intake's, Decision-framing's, Written-voice's, Adversarial-review's — each repeating 6-8 near-identical "answered — see X" lines. The accountant reads the top screen correctly, then hits ~35 lines of repetitive checklist before the document ends. This is the literal wall-of-text outcome the requester wants avoided, produced by four templates that are each individually well-behaved.

## 2. Best alternative not chosen

The alternative: a single shared composition rule — when N skills apply to one deliverable, their records collapse into one block, one row per skill, instead of N full blocks. Adversarial-review §5 gestures at this ("if the artifact under review carries its own record... the review checks it rather than repeating it") but that's a narrow exception for adversarial-review checking a *prior* record, not a general merge rule, and it doesn't fire for decision-framing + written-voice + intake stacking on each other. No file names this alternative or rejects it; it's simply absent. That absence is itself a finding.

## 3. Load-bearing-claims audit

- "Templates are the floor for weaker models" — every skill states machine-enforcement is absent and the record is "presence, not quality" (verbatim, in all seven files' closing sections). Consistent, but the claim that presence-checking floors *quality* for a weak model is asserted, not demonstrated — a weak model can satisfy every gate's letter while skipping its substance, and the record looks identical either way. **Unsupported as stated; see finding 2.**
- "Skills compose conditionally" [cite: requester] — true at the level of each skill's own stand-down logic, but no skill states a composition *output* rule. **Partially supported: composition triggers are sound, composition results are not specified.**
- "Every deliverable ends with a verification record" [cite: requester] — literally true per each file, and that's precisely the mechanism that compounds under composition. **Supported, and it's the mechanism behind finding 1.**

## 4. Assumption inversion

Stated design assumption: templates-over-judgment raises weak-model output quality. Invert it: assume it only raises output *shape*, not quality. What breaks — the operator trusts a well-formed record as a completeness signal and skips his own re-derivation, since that's the record's stated purpose ("made checkable for the reader"). The failure is silent (a vacuous "Strongest objection: answered — see X" pointing at a strawman is indistinguishable from a real one) and expensive (a shipped decision that never actually survived challenge). Nothing in the suite would surface this until the decision fails in the world.

Unstated assumption surfaced by the audit above: composition is additive with no collision. Invert it: assume it collides. What breaks — exactly finding 1's story, and it breaks silently, because each skill's own closing gates pass individually; only the composed document, which no single skill's gates inspect, is bloated.

## 5. Who bears the cost

Primarily the operator himself, in re-reading time on his own artifacts. But a second, less visible party bears a sharper cost: the occasional external reader (the requester's stated "handed to others" case). That reader has no context on why four checklist blocks appear, reasonably reads it as a lack of confidence in the sender's own judgment, or — worse — pattern-matches all four blocks as boilerplate and skims past the one that actually carries adversarial-review's verdict (which per §5 is supposed to be the artifact's first line, but in a stacked composition lands as the fourth block's first line instead, well past where a skimming reader is still paying attention).

## 6. The five-minute hostile expert

A technical-writing/process-design reviewer's first question: "where's the decision log and the handoff doc?" Given the stated user — a solo operator whose actual CLAUDE.md is full of dated NOTES entries recording small adjudicated decisions, and whose sessions explicitly end with a mandated "hand off — provide context for next session" step — these are the two highest-frequency real deliverable types this operator produces, and neither has a template anywhere in the set. decision-framing explicitly sends lightweight decisions away ("answer directly, skip this method"), which is correct scoping, but leaves zero shape behind for how to write the answer down. That's the gap a domain expert finds first, not the subtlest issue in the set.

## Findings

```
1. Composed deliverables stack N full verification-record blocks with no merge rule [severity: serious]
   Failure: a one-page decision, once run through 2-4 in-scope skills, ends in ~35 lines of
     repetitive "answered — see X" ceremony after ~350 words of content — the exact wall-of-text
     outcome the suite is meant to avoid.
   Evidence: no file defines composed-deliverable behavior; adversarial-review §5's only carve-out
     is narrow (checking a prior record, not merging multiple records) and doesn't cover the
     intake+decision-framing+written-voice case.
   Smallest fix: one shared rule — when N skills apply to one deliverable, their records collapse
     into a single block, one row per skill ("skill: gate summary"), not N blocks.

2. "Presence not quality" collides with "templates as the floor for weaker models" [severity: serious]
   Failure: a weak model fills every gate with a well-formed but vacuous pointer ("Strongest
     objection: answered — see X" pointing at a strawman); the record is indistinguishable from a
     genuine one, so the operator trusts it and skips his own re-derivation.
   Evidence: all seven skills state, verbatim in structure, "the record is presence, not quality" —
     acknowledged consistently, never resolved; presence-only checking is exactly the exploit a weak
     model defaults to.
   Smallest fix: require "see <where>" pointers to carry a quoted fragment, not just a location —
     makes emptiness visible to a presence-only check.

3. No lightweight decision-log / meeting-notes genre exists anywhere in the set [severity: serious]
   Failure: the operator's single most frequent real artifact — a short dated record of a small
     decision — has no template; decision-framing correctly stands down for it ("answer directly")
     but that leaves nothing behind, so he invents the shape ad hoc each time, which is the exact
     inconsistency templates-over-judgment exists to prevent.
   Evidence: decision-framing §1 explicitly excludes this case; written-voice's genre list (spec,
     proposal, status update, announcement, README) has no decision-log or handoff entry.
   Smallest fix: add a lightweight genre to written-voice — "Decision log entry" (reader: future
     self / next session) — one to three lines, dated, no mandatory verification-record block per
     written-voice §7's own carve-out for lightweight genres.
   Coverage ranking (missing repeatable deliverable types, by likely real demand for this user):
     1. Decision log / meeting-notes entry — HIGH — new genre in written-voice, not decision-framing
     2. Handoff doc — HIGH — new genre in written-voice (reader: next session/agent); context-mapping's
        "handoff test" validates a map, it doesn't produce this document
     3. Research synthesis (thematic, non-adversarial) — MEDIUM — extension of investigative-research
        or a new lightweight skill; due-diligence citation discipline is heavier than synthesis needs
     4. Status report — not a gap; already covered by written-voice's "Status update" genre
     5. Incident/postmortem — low priority for this suite specifically; this user's broader toolkit
        already carries a dedicated postmortem skill (engineering:incident-response) — overlap risk,
        not coverage gap, if one were added here too
     6. Presentation outline — LOW — low real demand for an operator who mostly writes, not decks
     7. Email/message (longer than chat, shorter than announcement) — LOW-MEDIUM — partially covered
        by Proposal/Status update/Announcement in combination

4. requirements-structuring's PRD "Risks" section invites a padded stub [severity: minor]
   Failure: a PRD written with no adversarial-review planned gets a one-line hedge ("might take
     longer") because the author knows real challenge is deferred to a discipline that may never run.
   Evidence: requirements-structuring §7 itself names the deferral ("the full challenge belongs to
     an adversarial review... if that discipline is present") — acknowledging the field is a
     placeholder for something that may not happen.
   Smallest fix: require the field to state either a concrete failure story (adversarial-review's own
     shape) or an explicit "deferred to adversarial-review" label — makes honest-stub and lazy-stub
     distinguishable.

5. context-mapping's four evidence tags have no class for the mapper's own authorship memory [severity: minor]
   Failure: a solo operator mapping a system he half-built tags his own recollection "was-told"
     (meant for a person or document asserting it) because none of the four classes fit "I built
     this and remember it" — the tag gets stretched rather than broken cleanly.
   Evidence: §4 defines exactly read/ran/was-told/inferred, all assuming mapper ≠ system author.
   Smallest fix: note "was-told" explicitly covers self-testimony ("I recall building/deciding this")
     as a named subtype, so the tag stays honest rather than silently overloaded.

6. Verification-record formatting is visually uniform regardless of stakes, inviting banner blindness on the one line that carries a verdict [severity: minor]
   Failure: in a stacked composition (finding 1), the block carrying adversarial-review's actual
     "Rejected" verdict is visually identical to three preceding blocks of routine gate confirmations;
     a reader who has already skimmed three near-identical checklists pattern-matches the fourth as
     more of the same and misses the verdict.
   Evidence: all seven skills use the same dash-bulleted "Label: answered — detail" syntax with no
     visual distinction for a block that carries a verdict versus one that carries only gate status.
   Smallest fix: when a record's skill also produces a verdict (adversarial-review, decision-framing),
     that line is set apart (e.g. "VERDICT:" in caps) both at first appearance and inside the record,
     so it survives compression even under stacking.
```

## Direct answers to the four assignment questions

**(1) Template soundness.** Each template individually holds up — no field is structurally dishonest, and the closed vocabularies do real work. The two real soundness defects are compositional, not individual: the "presence not quality" self-caveat that every skill states but none resolves (finding 2), and the requirements-structuring "Risks" field that quietly assumes a downstream discipline will do its job (finding 4).

**(2) The record-block pattern and ceremony.** Ceremony crowds out content specifically at the composition boundary, not within any single skill. A deliverable touched by one skill is well-proportioned; a deliverable touched by three or four — which is the normal case for a solo operator's real decisions, not an edge case — accumulates one full record block per skill with no shared-content merge, and that is where the wall-of-text outcome actually comes from (finding 1).

**(3) Coverage.** The suite is strong on structural/strategic documents (PRD, decision record, context map, investigative research) and has a real, ranked gap at the lightweight end: decision-log/meeting-notes entries and handoff docs are this specific user's highest-frequency artifacts and have no template anywhere in the seven files (finding 3). Status reporting is already covered and should not be added again.

**(4) Formatting DNA.** The genre shapes and labeled-field templates (intake block, decision record, context map, written-voice's five genres) actively push toward scannable, balanced output — short labeled fields read faster than prose and that part of the design works. The verification-record shape is the outlier: it is a monotone, repeated-syntax block by design, and while that is fine in isolation, it becomes the suite's one genuinely monotone element once stacked, and its uniformity is precisely what lets the highest-stakes line (a verdict) hide inside routine ceremony (finding 6).

Verification record
- Steelman stated:    answered — see "Steelman"
- All six run:        answered — findings from: strongest failure mode (finding 1), best alternative not chosen (finding 1's fix), load-bearing-claims audit (findings 2, 4), assumption inversion (findings 1, 2), who bears the cost (finding 1, external-reader case), five-minute hostile expert (finding 3)
- Findings concrete:  answered — 6 findings: 0 fatal, 3 serious, 3 minor
- One verdict:        answered — accepted with controls
- Self-review:        answered — independent (reviewer did not author the suite; no shared context with its author beyond the seven files read in this task)
- No improvement drift: answered — breakage only; each finding names the smallest fix, not a design
