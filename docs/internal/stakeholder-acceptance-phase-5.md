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
`DOCUMENT_CAP` in `src/hosts/sources.ts`; the watch it calls hardcoded was
hardcoded, with the `Watch` object built at `id: 'construct'` regardless of
`--root` (that code now lives in `src/cli/watch.ts`, and `--root` since became
the selector for which checkout to inspect, so the finding is fixed rather than
standing); the product-scoping signal list
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

---

## The wave-B cases (2026-08-10)

Five outcomes, one per concern the 2026-08-10 base-org work added, run end to
end through the shipped CLI the same way Case 1 was. **No role name was typed
in any of them.** Each names its run id, what routed and why, what the surface
did, the deliverable state, the defects it found, and the honesty flags that
traveled with it.

**On the money column.** These ran on the local `claude` binary under
subscription auth, so the figures the host reports are notional units, not a
charge. They are quoted because the ceiling binds on them and because a run
that reports nothing is unmeasured rather than free — the same rule this
project applies in the other direction.

**Read them back:** `construct show --run <id>` for the deliverables,
`construct log --run <id>` for what was done in whose name, `construct inbox`
for the four decisions these runs raised and left for you.

### Case 0 — the free path, which could not do it (`run-20260810235757089`)

Recorded first because it is the honest state of the cheapest option, and
because every case below would otherwise read as if the host choice were free.

```bash
construct outcome --host=opencode --model=ollama/qwen3.6:35b --binary=/opt/homebrew/bin/opencode "Decide whether Construct should invest the next phase in depth for the five new concerns or in breadth across more hosts, given the role-differentiation claim was withdrawn"
construct work --run run-20260810235757089 --ceiling=5
```

The namer worked and worked well: reading the outcome on a local 35b model it
named `program-sequencing`, `product-scoping`, `strategy-alignment` and
`system-design`, each with a stated reason, in well under a minute and at no
cost. Then every one of the four dispatches failed at exactly 600,000 ms —
`Host "opencode" invocation exceeded 600000ms` — having produced nothing, ten
minutes per role.

What the surface did right: it reported total failure as total failure rather
than as a quiet zero, printed the recorded error per role, and stated that a
failed task is terminal because the host owns retries. Nothing had to be
guessed at.

Two tracker items came out of it the same day. `construct-arr`: a 35b-class
local family cannot finish a grounded dispatch over a real repository inside
the pinned host's timeout, which is a capability floor worth recording rather
than rediscovering per run. `construct-0i6`: the obvious workaround — a
bounded ground on its own workspace — turns out to be unreachable, because
`construct source add` takes `--workspace` and `construct outcome` hardcodes
`default`.

### Case 2 — an architectural change (`run-20260811001419345`)

```bash
construct outcome --host=claude --binary=/opt/homebrew/bin/claude "Decide whether the host adapter seam should stay a thin process boundary or absorb retry and session state, given three hosts are now pinned and each reimplements timeout handling differently"
construct work --run run-20260811001419345 --ceiling=4
```

Routed to `system-design` alone, on the model's stated reason: the outcome is
about where a boundary sits and what becomes coupled. One grounded dispatch
over 40 surveyed documents, 0.72 reported, promotion `challenged`, two
structural verdicts recorded.

**The deliverable corrected the outcome's premise.** It found two pinned hosts,
not three, and showed why the third named surface structurally cannot have a
timeout to reimplement: `src/hosts/mcp/projection.ts` implements no `invoke`
or `init` and runs inside the calling host's loop. It then separated the two
boundaries the outcome conflated — the kernel/adapter seam, where a shared
timeout helper would be legitimate, and the seam/platform line, where retry and
session state sit and which STRATEGY commitment 1 vetoes by name. Its
reversibility section put the one reversible item (deduplicating the timeout
race) beside the two one-way doors, each with what unwinding would cost and who
would have to agree.

It raised exactly one ask, with a reversible default: whether "three hosts"
meant a pinned adapter the read material did not surface, proceeding meanwhile
on the two it actually found. That ask is in your inbox.

### Case 3 — an operability question (`run-20260811001658945`)

```bash
construct outcome --host=claude --binary=/opt/homebrew/bin/claude "Work out what happens after Construct is installed on someone else's machine and a run fails halfway: who finds out, what they can see, and what it costs to keep the work log trustworthy"
construct work --run run-20260811001658945 --ceiling=6
```

Routed to `operations`, `measurement` and `security` — three concerns, none
named by the user. 2.55 reported across them, all three `challenged`, six
structural verdicts.

**This case is the one that earned its keep twice.** The deliverables found
real things: that the append-only triggers protect rows from rewriting and do
nothing against `unlink`, so the store is one deletable file with no external
copy; that `construct log`'s live-run footer prints a lease deadline without
comparing it to now, so a crashed run reads as "Still running" until the reader
does the arithmetic; that the decision inbox's mid-framing loss (filed earlier
as construct-185) is still open and leaves an empty inbox indistinguishable
from a conflict-free run; and that `costSilent` is reported per invocation and
never accumulated, so "how much of what the ceiling protected was actually
metered" cannot be answered.

**And the run itself exposed two defects in the machinery reading it.** The
three roles disagreed — `operations` and `measurement` held, `security`
proceeded — and the framing that reached the inbox showed `security`'s position
with no reason and no citation, while its deliverable cited three files. The
cause: the framing parsed the role's *reply* rather than its submitted draft,
which is the same defect the challenge checks were fixed for and the stance
parser never was. Filed and fixed the same day (construct-f1u), with the live
shape as its regression test. Separately, a sentence-long stance qualifier bled
into the question's tally, making the question unreadable (construct-wei).

Scored artifact: `fixtures/conflict-quality/2026-08-10-live-run-operability.json`
and its `.score.json`, recorded as observed and never edited to score better.

### Case 4 — a user-experience question (`run-20260811002230681`)

```bash
construct outcome --host=claude --binary=/opt/homebrew/bin/claude "Make the first ten minutes of Construct understandable to someone who has never read the strategy, from install to reading back a deliverable they trust"
construct work --run run-20260811002230681 --ceiling=8
```

Routed to `user-experience` and `measurement`. 1.33 reported; `user-experience`
reached `final`, `measurement` `challenged`; four verdicts.

The measurement deliverable refused the outcome's own premise in the way the
lens is supposed to: the ten-minute claim in `docs/first-run.md` is asserted and
never measured, no timestamp is captured anywhere in the walkthrough or in Case
1's own record, and "a deliverable they trust" has no instrument behind it at
all — `construct verdict` answers whether the routing was right, which is a
different question. It marked each behavior observable or unobservable in
production today rather than proposing metrics nobody will collect.

The experience deliverable walked the actual path command by command and named
where it breaks: a host failure at `construct work` prints an error without the
`--host` and auth command that would fix it, where the `--escalate` dead end
already got exactly that treatment; `draft` and `challenged` are displayed with
no gloss and read as verdicts; and `--ceiling` never appears next to the
statement of its default.

### Case 5 — a security-flavored change (`run-20260811002510453`)

```bash
construct outcome --host=claude --binary=/opt/homebrew/bin/claude "Decide how the capability token a dispatched role carries should be scoped and revoked now that roles can write back through it and hosts keep their own transcripts"
construct work --run run-20260811002510453 --ceiling=10
```

Routed to `operations`, `security` and `system-design`. 3.04 reported, all
three `final`, six verdicts.

The security deliverable held its defensive ceiling — exposures, paths, checks,
no tooling — and traced each threat path from who can reach the surface to what
they gain. The finding worth acting on: there is no operator-triggered way to
cut a token off before its lease expires. The only levers are waiting out the
lease or deleting the shared secret, which revokes every run in flight. It also
noted the `nonce` field is minted and never checked, and that the cost of
wiring it rises the longer real runs come to depend on the current tolerant
behavior.

The operations deliverable found that a denial flood — the system's own designed
evidence of a role fighting its grants — accumulates in the work log and is
surfaced nowhere an operator looks: not in `construct log`'s footer, not in
`construct doctor`.

### Case 6 — a strategy bet (`run-20260811003148519`)

```bash
construct outcome --host=claude --binary=/opt/homebrew/bin/claude "Decide whether the next phase should buy depth on the five newest concerns or breadth across more hosts, given the role-differentiation claim was withdrawn and only one model family is tuned"
construct work --run run-20260811003148519 --ceiling=12
```

Routed to `strategy-alignment` and `program-sequencing`. 1.63 reported, both
`challenged`, four verdicts.

**It read this packet's own gate and told the truth about it.** The
strategy-alignment deliverable states that the five-concern epic's closing step
is blocked on a depth reading that exists only for an untuned family, and
recommends re-running the five-pack harness on the tuned family before wave-D
packets are recorded — with the alternative named honestly as yours to take:
proceed on the untuned reading if you judge it acceptable. It also found that
"breadth across more hosts" has no bead, no plan document and no named owner
anywhere in the material, and that scheduling it now collides with commitment
1's own Phase 4/5 gate.

**Honesty flag:** the `program-sequencing` dispatch reported five failed tool
calls and answered anyway; that is flagged on the deliverable, not buried.

### What these five cases cost and what they produced

Total reported across the store after all of them: 10.66 notional units, of
which 1.37 was Case 1. Nine deliverables across five runs, every one of them
readable by `construct show`, every declared challenge answered (zero
`challenge-unanswered` entries across all five), 22 structural verdicts
recorded, four decisions raised and left open for you.

**Defects found, all filed the same day:** construct-arr, construct-0i6,
construct-f1u (fixed), construct-wei. Case 3 and Case 5 additionally
re-surfaced construct-185 as still open.

### Your move

Read each case's deliverables and accept or reject that case here, and record
its routing verdict in the product:

```bash
construct show --run <id>
construct verdict --run <id> --confirm=<domain>   # or --missed=<domain>
```

- [ ] Case 0 — the free path's failure, recorded rather than hidden
- [ ] Case 2 — architectural change (`system-design`)
- [ ] Case 3 — operability (`operations`, `measurement`, `security`)
- [ ] Case 4 — user experience (`user-experience`, `measurement`)
- [ ] Case 5 — security-flavored change (`security`, `operations`, `system-design`)
- [ ] Case 6 — strategy bet (`strategy-alignment`, `program-sequencing`)

**What accepting these would license, and what it would not.** It would license
the statement that each of the five new concerns carried a real outcome end to
end through the shipped surface, with no role name typed, and produced a
deliverable the stakeholder judged adequate. It would license nothing about any
user other than the author, and no rate across outcomes. It is a product
judgment on top of measured evidence, and it is never itself a measurement.

**One thing it explicitly does not settle**, because Case 6's own deliverable
raised it: these ran on the one tuned family. The depth readings the wave-B
packs closed on came from an untuned local family, and re-running that harness
on the tuned family is a different measurement from this packet.
