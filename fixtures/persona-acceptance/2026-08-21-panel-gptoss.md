# Persona-rubric panel — second family (gpt-oss:20b), 2026-08-21

**Judge:** claude-sonnet-5 (Claude, Anthropic family), this session, reading
`docs/persona-acceptance-rubrics.md` as committed before any deliverable in
this pass existed — the file predates this session's first `ask` call by
several sessions. Recorded under the standing LLM-as-judge approval; Gerald
checks outcomes.

**Producer:** `ollama/gpt-oss:20b`, OpenAI-lineage open-weight, dispatched
locally through Ollama (`http://localhost:11434`) and the pinned OpenCode host
adapter (`src/hosts/opencode/`), binary `/opt/homebrew/bin/opencode`.

## Why the correlated-error caveat does not apply here

The judge and the producer share no model family. `fixtures/persona-acceptance/2026-08-10-panel-waveb.md`
named the exact strengthening this project owed itself: *"a second judge from
a different family reading the same deliverables... gpt-oss:20b is served
locally and free, though its judging quality is itself unmeasured."* This pass
is that strengthening, on the producer side: a cross-family producer judged by
Claude, rather than a same-family producer judged by Claude. Observed
agreement below is not inflated by the shared-family blind spot the wave-B
pass had to caveat.

What this pass is **not**: a second, independent replication of the
2026-08-06 qwen findings. Different model, different questions, different
day — nothing here re-scores those five deliverables, and their recorded
verdicts stand as-run. It is also not a claim about any user other than the
author, per the rubric document's own stated limit.

## The two-family clause

construct-t4n's unmet acceptance clause: *"at least one panel pass over
deliverables from two or more families."* The 2026-08-06 pass
(`fixtures/persona-acceptance/2026-08-06-panel-claude.md`) covered
`qwen3.5:4b` and `qwen3.6:35b` — two models of one family. This pass adds
`gpt-oss:20b`, a genuinely second family. The clause is met: two recorded
panel passes exist, together covering deliverables from qwen and gpt-oss.
Gerald's acceptance remains the separate, un-automatable close gate the
bead's own notes name (`construct-t4n`, 2026-08-20 DISPATCH note); this pass
does not close that bead by itself, and nothing here runs `bd`.

## Scope

Rubric verdicts on deliverable adequacy, same as both prior passes. No
`construct verdict` was recorded and the routing-label corpus is untouched.
Every deliverable below is short — a single `ask` answer, not a multi-section
outcome document — and was read in full, via `construct show`, not summarized
from the terminal transcript alone.

## How these deliverables were produced

Real runs through the shipped surface, free by design so re-verification
costs nothing:

```
construct ask "<outcome>" --host=opencode --binary=/opt/homebrew/bin/opencode \
  --model=ollama/gpt-oss:20b --dir=<sterile scratch dir>
construct show --run <run-id>
```

Isolation: `XDG_DATA_HOME` pointed at a fresh temporary directory for every
run in this pass, never `~/.local/share/construct` — confirmed afterward by
running `construct show` against the same run id with no override, which
fails against the real store rather than finding it, and by the real store's
own schema having moved on independently of anything here. `--dir` pointed at
an empty, throwaway, git-initialized scratch directory, never this checkout;
both scratch paths are discarded with the session. No source was declared for
the workspace, so every deliverable rests on what the model knows plus the
outcome text itself — flagged on screen every time ("no sources declared for
this workspace, so the answer rests on what the model knows rather than on
your material").

Cost: every run reports `$0`, which is unmeasured, not free in general —
local Ollama dispatch carries no cost accounting, the same honesty note phase
4 and wave-B recorded.

Untuned: `src/hosts/tuning.ts` records the Claude family as the only tuned
entry, so every dispatch here writes a `model-untuned-best-effort` limit.
Confirmed by reading each deliverable back through `construct show` rather
than assumed from source: the best-effort label, and — on the two runs framed
through the legal lens — a licensed-review label, both travel with the
deliverable body itself, not only the surrounding CLI narration.

## Verdicts

| # | Run / role | Producer | Persona | Verdict | Deciding lines |
|---|---|---|---|---|---|
| 1 | `run-20260821053731522` / security | gpt-oss:20b | Security engineer | **reject** | Y2 (blast radius never stated concretely) |
| 2 | `run-20260821053956975` / contracts | gpt-oss:20b | Legal | **reject** | C2 (no numbered issues; one blended recommendation), L1 (reads as direct advice) |
| 3 | `run-20260821054257053` / product-scoping | gpt-oss:20b | Product manager | **reject** | P1 (conflict evidenced both sides, never named as a conflict; no owner) |
| 4 | `run-20260821054628045` / employment | gpt-oss:20b | Legal | **reject** | C2 (no actionable steps), L1 (no employment-law issue-spotting at all) |

Four of four reject. This is consistent with, not harsher than, what the
project already has on record for untuned local families: the 2026-08-06
pass rejected four of five, and `docs/stakeholder-acceptance-phase-4.md`
already states plainly that "the open-weight depth gap... is MEASURED, not
fixed" and stays best-effort. A local, untuned 20B model failing rubric
must-lines across the board is the expected finding, not a sign of a
miscalibrated judge — see the per-line evidence below.

## Per-deliverable evidence

### 1 — security (`run-20260821053731522`)

Asked: an architecture-split question ("split notification delivery out into
its own service... without today's tight coupling"), aimed at system-design.
The namer read it as security instead ("The split introduces new boundaries
that affect who can reach what and how failures are handled") — a defensible
read, and it lands squarely on a rubric-covered persona, so it stays in the
panel under the persona it actually earned.

- **Y1** (must, reach → gain → check): mostly holds. Item 1: "expose
  notification data to unauthenticated or over‑privileged callers... must
  enforce the same user‑level access controls." Item 4: "an attacker could
  replay or forge requests... TLS/mTLS and carry authenticated tokens."
  Generic-textbook in register, but each item names who reaches, what they
  gain, and the stopping check. **Pass, with the generic-checklist caveat
  below.**
- **Y2** (must, "Blast radius is stated concretely — one record, one tenant,
  every tenant, or persistent access — not as a severity word"): no line in
  the deliverable states blast radius in those terms. The closest it gets is
  severity-flavored verbs — "expose," "leak," "abused" — which is exactly
  what the rubric line names as insufficient. **Fail.**
- **Y3** (must, stays defensive): holds throughout; no exploit, no attack
  tooling, no evasion guidance. **Pass.**
- **Y4** (should, evidence of past misuse / whether anything records it
  today): the deliverable is forward-looking only ("metrics, logs, and
  distributed traces must be added," "all notification actions should be
  auditable") — recommends adding detection, never states whether anything
  records it *today* or what would show the exposure had already been used.
  **Partial / should-line miss.**

Verdict: **reject**, on Y2.

Template note: the security template calls for headed sections `finding`,
`attack-surface`, `mitigations`, `threat-paths` (`src/kernel/plan/playbooks.ts`,
`src/kernel/plan/lenses.ts`); `construct show` reports none of them present —
"security assessment asks for finding, attack-surface, mitigations,
threat-paths and no section was headed there." The missing `attack-surface`
slot ("what the outcome exposes and to whom") is exactly where Y2's blast
radius would have been forced into the open; its absence is the direct,
traceable mechanism behind the Y2 failure, not a coincidence.

### 2 — contracts (`run-20260821053956975`)

Asked a resourcing-priority question aimed at strategy-alignment ("Should we
keep the admin console commitment or pivot the quarter to the search
rebuild"); the namer read "publicly committed" as a binding promise and
routed to contracts ("creating a binding promise").

- **C2** (must, common floor: "numbered issues with the step that resolves
  each"): the whole answer is one paragraph, one recommendation, no
  numbering — "Keep the public commitment to ship the enterprise admin
  console this quarter." The contracts template declares form `issues`; this
  is prose. **Fail.**
- **L1** (must, "Nothing reads as advice: issue-spot, draft, escalate...
  every finding flagged for licensed review"): split finding. The
  licensed-review half holds — `construct show` prints "issue-spotting only:
  needs review by a licensed attorney before you rely on it" on every read,
  sourced from the legal lens's own `labeling` field, not from anything the
  model wrote, so this part is a system guarantee and it worked. The
  issue-spot half does not: "Keep the public commitment..." is a direct,
  prescriptive recommendation, not an issue named and routed for someone
  else to decide. **Fail, narrowly on the advice-shaped framing, not on a
  missing safety label.**
- **L2** (must, jurisdiction-dependence named): no jurisdiction-dependent
  claim is made at all, and the deliverable correctly leaves "contractual or
  regulatory penalties for delaying" as an open question rather than
  assuming an answer. **Pass (vacuous — nothing to silently assume).**
- **L3** (must, provenance/authorship where machine writes enter a system of
  record): not applicable — this scenario has no system-of-record content.
- **L4** (should, licensed-review recommendation is specific): the
  system-injected label is generic ("needs review by a licensed attorney"),
  names no specific issue or jurisdiction question. **Fail.**

Verdict: **reject**, on C2 and L1.

### 3 — product-scoping (`run-20260821054257053`)

Asked a PRD-shaped scoping question with a built-in conflict: sales promised
CSV export for the beta, the design spec's beta scope was read-only-only.
This is the one attempt that landed exactly on its intended domain and
persona.

- **P1** (must, "Conflicting commitments are surfaced with both sides cited
  and an owner named"): both sides are individually evidenced — "The sales
  promise references a CSV export for the beta" and "The design spec
  documents the read‑only dashboard view as the only feature for the beta"
  both appear in the evidence list — but they are never named together as a
  conflict requiring a decision, and no owner is named for the call. The
  deliverable instead silently resolves the tension itself ("The first beta
  should ship the read‑only dashboard view **and** a minimal CSV export").
  That resolution may even be reasonable product judgment, but P1 asks for
  the conflict to be surfaced to an owner, not quietly settled by the
  drafting role. **Fail.**
- **P2** (must, explicit scope boundaries): clean pass — "The following items
  should wait for a later release" names four deferred items explicitly.
  **Pass.**
- **P3** (should, success measure named, data-existence flagged): "How to
  know it worked" names four concrete measures (functional test, smoke test,
  customer confirmation, telemetry) and the open-questions section explicitly
  flags whether the metrics endpoint needed for telemetry exists, rather than
  assuming it. **Pass — the strongest should-line result in this pass.**

Verdict: **reject**, on P1.

Template note: `construct show` lists the missing headings as "finding,
risks, users-and-problem, in-scope, out-of-scope, success-measures,
commitment-conflicts." The product lens's own `commitment-conflicts` slot is
defined as "commitments that cannot both hold, each side cited, with who owns
the call" (`src/kernel/plan/lenses.ts`) — worded almost identically to P1
itself. That slot was never produced; its absence is the same
template-avoidance pattern as deliverable 1, and it is the direct mechanism
behind the P1 failure.

### 4 — employment (`run-20260821054628045`)

Asked a decision-shaped, strategy-alignment question ("prioritize... or
double down on... instead of building it, since we can't staff both at the
same time... trade-off"). The namer read "staff" as an employment
constraint and routed to employment ("the team cannot staff both projects at
once") rather than the intended strategy-alignment. A follow-up attempt,
reworded to replace "staff" with "engineering bandwidth" specifically to
remove that pull, still missed strategy-alignment — it is the discarded run
below, and both misses are counted together in cross-cutting finding 5.

- **C2** (must, actionable numbering): two sentences of trade-off framing,
  no numbering, no clear directive beyond an implicit "watch the pipeline for
  failure." **Fail.**
- **L1** (must): more severe than deliverable 2. This deliverable contains no
  employment-law content whatsoever — no notice obligation, no reassignment
  risk, no classification question, nothing that reads as legal issue-spotting
  at all. It answers as a generic resourcing trade-off ("building the new
  analytics module will give the team a new capability... but it will also
  divert the limited staff from stabilizing the existing reporting
  pipeline") wearing the employment/legal lens's system-injected label
  ("issue-spotting only: needs review by a licensed attorney") without ever
  engaging the lens's actual subject. **Fail.**
- **L2, L3:** not applicable — no jurisdiction-dependent or system-of-record
  content in this scenario.
- **L4** (should): fails for the same generic-label reason as deliverable 2.

Verdict: **reject**, on C2 and L1.

## Cross-cutting findings

1. **Structural slot-heading non-compliance, all four deliverables.**
   gpt-oss:20b never used any domain template's required headed sections. It
   substituted one generic shape every time — `**answer**` / `**evidence**` /
   `**limits**` / `**open-questions**` / `**claims-cited**`, often closed with
   an `ASK` / `ASSUMING` pair — regardless of which template
   (`src/kernel/plan/playbooks.ts`) it was actually given. `construct show`
   already surfaces this per-deliverable rather than hiding it ("...and no
   section was headed there — a fact about this deliverable, not a reason it
   was withheld"). This is not previously recorded: `fixtures/model-floors/2026-08-06-ollama-gpt-oss-20b.json`
   measured only the namer and densifier JSON seams, never deliverable
   slot-heading compliance. It is a distinct capability-floor fact, separate
   from and in addition to the namer-contract floor already on file for this
   model.
2. **The gap is traceable, not incidental.** The product lens's
   `commitment-conflicts` slot and the security template's `attack-surface`
   slot are each worded to force exactly the content their respective
   must-line (P1, Y2) requires. Neither slot was produced in the deliverable
   that needed it. The missing structure and the missing content are the same
   defect, seen from two sides.
3. **Citation-tag format non-conformance, all four deliverables.** Every
   deliverable consistently distinguishes engagement-grounded claims from
   unverified ones — but always as `(engagement)` / "— this one still needs
   checking against a source" prose, never the bracket syntax
   `[cite:engagement]` / `[unverified]` that `assignmentFor`'s
   `MATERIAL_PROTOCOL` and engagement instruction explicitly request
   (`src/kernel/run/coordinator.ts`). Judged substantively honest — nothing
   is invented, and `findScaffoldingCitations` flags none of these deliverables
   (no citation names the domain catalog, a lens, the playbook, the work log,
   or the keyword map as authority) — but formally non-conformant: the
   automated tier-1 citation check (`src/kernel/verify/claims.ts`) would not
   recognize `(engagement)` as a valid tag. Scored here as a pass on
   substance for every deliverable's common-floor C1, with this format gap
   named explicitly rather than silently absorbed into the verdict, because a
   future session relying on the automated check alone to validate gpt-oss:20b
   output would be misled by it.
4. **The licensed-review label is a system guarantee, and it held.** Both
   legal-lens deliverables (contracts, employment) carried "issue-spotting
   only: needs review by a licensed attorney before you rely on it" via
   `construct show`, sourced from the lens's own `labeling` field, not
   anything the model wrote. C4 and the licensed-review half of L1 pass on
   every legal-lens run regardless of producer quality — the construct-z34
   fix (2026-08-10) generalizes correctly to a model family it was never
   tested against. What still fails is content: whether the prose reads as
   an issue-spot or as advice, and whether it engages the lens's subject at
   all.
5. **The namer never once chose strategy-alignment or system-design.** Six
   `ask` attempts were made in this session (four in the panel above, two
   discarded below); three were deliberately aimed at strategy-alignment or
   system-design, including two reworded specifically to remove accidental
   keyword collisions and load the intended domain's own vocabulary
   ("monolithic... split... out... scale... coupling" for system-design;
   "prioritize... double down... instead of... trade-off" for
   strategy-alignment). None landed there. The namer instead chose
   commerce-tax, security, contracts, employment, and product-scoping
   (twice) — consistently reading ambiguous business scenarios through a
   risk/obligation/scope lens rather than an architecture/strategy one. Every
   one of the six held its JSON output contract cleanly; no `namer-failed`
   fallback fired on any run. This is a real behavioral characteristic of
   gpt-oss:20b as a namer on this catalog, not a plumbing defect, and a
   future session should not assume this family reaches strategy-alignment or
   system-design reliably through `ask`.

## Discarded runs, kept for transparency

Two runs are not in the panel above:

- `run-20260821053400215` — the first phrasing of the system-design question
  included "payment capture," which pulled the namer to commerce-tax (reason:
  "splitting may affect billing and tax flows") — a domain the persona
  rubrics do not cover. Reworded to remove the payment framing and re-asked
  as `run-20260821053731522` (deliverable 1 above).
- `run-20260821054927566` — a second attempt at a strategy-alignment
  question, reworded to replace "staff" with "engineering bandwidth" after
  deliverable 4's routing showed that word's pull toward employment. This
  attempt landed on product-scoping instead ("The choice directly sets what
  is in scope for the quarter"), duplicating deliverable 3's persona. Not
  scored a second time against the same rubric from a different run; the
  finding it adds — a third strategy-alignment miss — is already counted in
  cross-cutting finding 5 rather than given its own row.

Neither run touched the real store or this checkout; both used the same
sterile isolation described above.

## What this pass licenses, and what it does not

It licenses exactly what the 2026-08-06 and 2026-08-10 passes licensed:
rubric verdicts on the deliverables actually produced, from a judge that
read them, nothing about any user other than the author, and no rate. It
adds one new thing those two could not: a producer outside Claude's own
family, closing construct-t4n's two-family clause. It does not close
construct-t4n — Gerald's acceptance is that bead's own separate, named gate,
untouched here, and nothing in this session ran `bd`.
