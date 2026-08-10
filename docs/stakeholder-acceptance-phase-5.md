# Phase 5 stakeholder acceptance: recorded outcomes

Per STRATEGY Phase 5 as amended 2026-08-05: real outcomes run end to end
through the shipped surface without the user typing a role name, recorded
here as a reviewable packet, read and accepted or rejected by the
stakeholder. What acceptance licenses is stated in STRATEGY in full —
nothing about anyone other than the author.

## Case 1 — a grounded product requirements document from a pointed-at repository (2026-08-10)

**Run:** `run-20260810161440172`, branch `feat/source-reads`, claude host
(`--binary=/opt/homebrew/bin/claude`), spend $1.37 of a $5.00 ceiling.

**What was typed, in full:**

```bash
construct source add --kind=git --locator=/Users/geralddagher/Developer/Projects/construct
construct outcome "Produce a product requirements document for pointing Construct at an existing repository so it acts as the team's product manager, grounded in what the codebase and strategy support today" --host=claude
construct work --run run-20260810161440172 --ceiling=5
```

No role name was typed. The namer implicated `product-scoping` alone, with
its stated reason on the record.

**What the surface did, per the work log:** densified the intake
(constraints and decisions extracted), surveyed the declared repository (40
of 356 documents listed, the remainder recorded as a partial read, the root
licensed for reads beyond the list), dispatched one grounded role with a
capability token, and settled with two structural verdicts and a promotion
state. Read it back: `construct log --run run-20260810161440172` and
`construct show --run run-20260810161440172`.

**The deliverable:** a product requirements document with every template
slot filled — finding, evidence, risks, users-and-problem, in-scope,
out-of-scope, success-measures, phasing, and three commitment-conflicts,
each with a named owner. Claims cite repository paths; the cross-user claim
is `[unverified]` by design. Three of its findings were real drift this
packet's own repo inherited, and each became a tracker item the same day:

- the CHANGELOG still called the grounded path dormant on the branch that
  made it live (fixed in this CHANGELOG's Unreleased section);
- `construct watch` accepts `--root` and ignores it (construct-4t8);
- `scope-diff` failed the very heading the template dictates
  (construct-5ww, fixed and tested the same day).

**Honesty flags that traveled with it:** the host reported 4 failed tool
calls, flagged on the deliverable; the model identity was unreported by the
adapter, so the dispatch carries an untuned best-effort note even though the
family is tuned (construct-n9d tracks the adapter fix); `claims-cited`
passed under the ground-root license; `scope-diff` recorded failed on the
hyphenated-heading defect, kept as recorded — the verdict is evidence of
the instrument's state that day, not an error to erase.

**Stakeholder's move:** read the deliverable (`construct show --run
run-20260810161440172`), then accept or reject this case here, and record
the routing verdict (`construct verdict --run run-20260810161440172
--confirm=product-scoping` or `--missed=<domain>`).

- [x] **Accepted — Gerald, 2026-08-10** (directed in chat; recorded by the
  session on his instruction). The routing verdict is recorded in the
  product: `construct verdict --run run-20260810161440172
  --confirm=product-scoping`, verdict #1, one confirmed.

**Why it was accepted, on the merits.** The deliverable's load-bearing
claims were re-checked against the tree before acceptance rather than
taken from this packet's own summary: the 40-document cap it cites is
`DOCUMENT_CAP` in `src/hosts/sources.ts`; the watch it calls hardcoded is
hardcoded, at `src/cli/index.ts` where the `Watch` object is built with
`id: 'construct'` regardless of `--root`; the product-scoping signal list
genuinely contains no word for repository or codebase, which is the
routing gap the deliverable says it is; and the CHANGELOG sentence it
quotes was true of the branch when the run happened and has since been
corrected. It filled every required slot, kept the cross-user claim
`[unverified]` by design, named an owner on each commitment conflict, and
raised exactly one requirements question with a reversible default. It
found three real defects in its own host repository.

**What this acceptance licenses, and what it does not.** It licenses the
statement that the grounded product-scoping path carried one real outcome
end to end through the shipped surface, with no role name typed, and
produced a deliverable the stakeholder judged adequate. It licenses
nothing about any user other than the author, and no rate across
outcomes: one accepted case is one accepted case. Phase 4's own criteria
are unaffected by it — the second tuned family remains unmet
(construct-fdl) and the program pack's reopened depth criterion remains
open, both of which STRATEGY carries in its own words.
