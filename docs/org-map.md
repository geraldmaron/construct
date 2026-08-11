# The org map: which seat each concern answers for

*Generated from the catalog by `scripts/generate-org-map.mjs`. Do not edit by
hand — a hand-edited copy drifts from the thing it describes, and the gate
regenerates and compares.*

An organization runs on contracts nobody wrote down. Somebody always asks who
owns this when it breaks; somebody always asks what we are giving up by saying
yes; somebody always asks whether the person whose data this is could ask for it
back. Those questions are not job descriptions. They are obligations that attach
to the work, and on a small team or a fast one they get skipped — not because
anyone decided to skip them, but because the person who would have asked was not
in the room.

This is that set of obligations, made explicit and routed from your own words.
You describe an outcome; the concerns it touches are inferred; each one carries
what it owes. **You never type a role name.**

## What this page claims, and what it does not

Each entry below is generated from the shipped catalog, so it states what a
concern is *obliged* to produce — the sections that must be filled, the
challenges the deliverable must answer, the limit the concern states about
itself. That is a promise about the deliverable.

It is **not** a claim that the concern sees something the others would miss.
That claim was measured over two independently authored fixture organizations,
failed, and was withdrawn on 2026-08-10; the external record reached the same
result first. Two concerns routed at one outcome is worth having because both
obligations get answered and any disagreement between them reaches you framed —
not because each brings private sight.

Nor is it a completeness claim. Routing misses roughly three in ten of the
concerns a labeler marks implicated on wording its authors never saw. The figure
and its interval are in the README and in full in `RESEARCH-DECISIONS.md` §10.

13 of 15 concerns carry a lens — a posture, an escalation
ladder, and extra required sections. The rest route and carry the default
template, and say so.

## The seats

### Counsel — `privacy`

**The concern.** Personal data, consent, and cross-border transfer.

**What it hands you.** A privacy review, with these sections required before the work is called finished:

- `finding` — the conclusion, stated first, in plain language
- `evidence` — what supports the finding, each item citing a source read or the domain catalog
- `risks` — what could make the finding wrong, or "none identified" said explicitly
- `open-questions` *(optional)* — what remains unknown, each with the assumed default the draft proceeds on
- `data-inventory` — what personal data the outcome touches, or "none" explicitly
- `licensed-review` — the recommendation to a licensed professional this draft does not replace
- `provenance-and-authorship` — where records the organization relies on come from, and whether their origin can be proven or only assumed

**What it must answer before anyone relies on it.**

- `claims-cited` — Does every load-bearing claim carry a citation or an [unverified] tag?
- `scope-diff` — What did the brief ask for that this deliverable does not cover?
- `legal-issue-spot` — Has a legal issue-spotting pass read this deliverable?

**Its posture.** Issue-spot, draft, escalate — never advise: name the exposure, cite what creates it, and route what needs a licensed human to a licensed human.

**What it surfaces to you rather than deciding itself.**

- Anything that reads as advice rather than an issue spotted: stop and relabel as template-for-review.
- A finding outside the declared jurisdictions: flag it as outside coverage; do not analyze past the flag.

**Before you rely on it.** Issue-spotting only: it needs review by a licensed attorney. Nothing this concern produces is advice.

### Finance / billing — `commerce-tax`

**The concern.** Taking money: pricing, billing, tax, and refunds.

**What it hands you.** A review memo, with these sections required before the work is called finished:

- `finding` — the conclusion, stated first, in plain language
- `evidence` — what supports the finding, each item citing a source read or the domain catalog
- `risks` — what could make the finding wrong, or "none identified" said explicitly
- `open-questions` *(optional)* — what remains unknown, each with the assumed default the draft proceeds on

**What it must answer before anyone relies on it.**

- `claims-cited` — Does every load-bearing claim carry a citation or an [unverified] tag?
- `scope-diff` — What did the brief ask for that this deliverable does not cover?
- `legal-issue-spot` — Has a legal issue-spotting pass read this deliverable?

**No lens.** This concern routes and carries the default template. It is listed saying so rather than implying depth it does not have.

**Before you rely on it.** Issue-spotting only: it needs review by a licensed tax professional. Nothing this concern produces is advice.

### Counsel — `contracts`

**The concern.** Agreements with other parties and what they bind you to.

**What it hands you.** An agreement review, with these sections required before the work is called finished:

- `finding` — the conclusion, stated first, in plain language
- `evidence` — what supports the finding, each item citing a source read or the domain catalog
- `risks` — what could make the finding wrong, or "none identified" said explicitly
- `open-questions` *(optional)* — what remains unknown, each with the assumed default the draft proceeds on
- `parties-and-terms` — who is bound and to what, as read from the source
- `licensed-review` — the recommendation to a licensed professional this draft does not replace
- `provenance-and-authorship` — where records the organization relies on come from, and whether their origin can be proven or only assumed

**What it must answer before anyone relies on it.**

- `claims-cited` — Does every load-bearing claim carry a citation or an [unverified] tag?
- `scope-diff` — What did the brief ask for that this deliverable does not cover?
- `legal-issue-spot` — Has a legal issue-spotting pass read this deliverable?

**Its posture.** Issue-spot, draft, escalate — never advise: name the exposure, cite what creates it, and route what needs a licensed human to a licensed human.

**What it surfaces to you rather than deciding itself.**

- Anything that reads as advice rather than an issue spotted: stop and relabel as template-for-review.
- A finding outside the declared jurisdictions: flag it as outside coverage; do not analyze past the flag.

**Before you rely on it.** Issue-spotting only: it needs review by a licensed attorney. Nothing this concern produces is advice.

### Counsel — `employment`

**The concern.** People you engage and how you engage them.

**What it hands you.** A review memo, with these sections required before the work is called finished:

- `finding` — the conclusion, stated first, in plain language
- `evidence` — what supports the finding, each item citing a source read or the domain catalog
- `risks` — what could make the finding wrong, or "none identified" said explicitly
- `open-questions` *(optional)* — what remains unknown, each with the assumed default the draft proceeds on
- `provenance-and-authorship` — where records the organization relies on come from, and whether their origin can be proven or only assumed
- `licensed-review` — the recommendation to a licensed professional this draft does not replace

**What it must answer before anyone relies on it.**

- `claims-cited` — Does every load-bearing claim carry a citation or an [unverified] tag?
- `scope-diff` — What did the brief ask for that this deliverable does not cover?
- `legal-issue-spot` — Has a legal issue-spotting pass read this deliverable?

**Its posture.** Issue-spot, draft, escalate — never advise: name the exposure, cite what creates it, and route what needs a licensed human to a licensed human.

**What it surfaces to you rather than deciding itself.**

- Anything that reads as advice rather than an issue spotted: stop and relabel as template-for-review.
- A finding outside the declared jurisdictions: flag it as outside coverage; do not analyze past the flag.

**Before you rely on it.** Issue-spotting only: it needs review by a licensed attorney. Nothing this concern produces is advice.

### Security engineer — `security`

**The concern.** Who can reach what, and what happens when that fails.

**What it hands you.** A security assessment, with these sections required before the work is called finished:

- `finding` — the conclusion, stated first, in plain language
- `evidence` — what supports the finding, each item citing a source read or the domain catalog
- `risks` — what could make the finding wrong, or "none identified" said explicitly
- `open-questions` *(optional)* — what remains unknown, each with the assumed default the draft proceeds on
- `attack-surface` — what the outcome exposes and to whom
- `mitigations` — what reduces each exposure, tied to the surface it reduces
- `threat-paths` — each path from who can reach it to what they gain, feeding the attack-surface slot, with the check that stops it or the gap where none does

**What it must answer before anyone relies on it.**

- `claims-cited` — Does every load-bearing claim carry a citation or an [unverified] tag?
- `scope-diff` — What did the brief ask for that this deliverable does not cover?

**Its posture.** Assume the interesting failure is deliberate: the question is not what breaks by accident but what someone gains by making it break.

**What it surfaces to you rather than deciding itself.**

- A reachable path to data or funds with no enforced check: surface it as its own finding, never as a note under something else.
- An exposure whose evidence trail does not exist: name the unobservability as the finding — an incident nobody can reconstruct is a second failure.

**Its stated limit, which is the invariant and not a gap.** Defensive review only: this lens names exposures, the paths that reach them, and the checks that would stop them. It does not write exploits, produce working attack tooling, or help evade detection.

### Compliance — `compliance`

**The concern.** Certifications, audits, and regulator-facing obligations.

**What it hands you.** A review memo, with these sections required before the work is called finished:

- `finding` — the conclusion, stated first, in plain language
- `evidence` — what supports the finding, each item citing a source read or the domain catalog
- `risks` — what could make the finding wrong, or "none identified" said explicitly
- `open-questions` *(optional)* — what remains unknown, each with the assumed default the draft proceeds on
- `access-and-audit` — for each change in who or what acts: the identity that acts afterward, the audit trail that records it, and who reviews that access

**What it must answer before anyone relies on it.**

- `claims-cited` — Does every load-bearing claim carry a citation or an [unverified] tag?
- `scope-diff` — What did the brief ask for that this deliverable does not cover?
- `legal-issue-spot` — Has a legal issue-spotting pass read this deliverable?

**Its posture.** Controls and evidence over intent: a change is what it does to who can act, what gets recorded, and what an auditor can verify afterward.

**What it surfaces to you rather than deciding itself.**

- A control gap with no owner: put the ownership question in the decision inbox.
- A regulator-facing obligation possibly breached: route to licensed review before anything relies on the finding.

**Before you rely on it.** Issue-spotting only: it needs review by a licensed attorney. Nothing this concern produces is advice.

### Designer / UX — `accessibility`

**The concern.** Whether people with disabilities can actually use it.

**What it hands you.** A review memo, with these sections required before the work is called finished:

- `finding` — the conclusion, stated first, in plain language
- `evidence` — what supports the finding, each item citing a source read or the domain catalog
- `risks` — what could make the finding wrong, or "none identified" said explicitly
- `open-questions` *(optional)* — what remains unknown, each with the assumed default the draft proceeds on
- `flow-dead-ends` — each point where the user can get stuck, with what the interface says there and what it should offer instead

**What it must answer before anyone relies on it.**

- `claims-cited` — Does every load-bearing claim carry a citation or an [unverified] tag?
- `scope-diff` — What did the brief ask for that this deliverable does not cover?

**Its posture.** The interface is the argument the product makes for itself: if someone has to be told how it works, that telling is the defect.

**What it surfaces to you rather than deciding itself.**

- A dead end with no recovery path: surface it as a finding, not a polish item.
- A pattern change that contradicts what the product already taught: name the migration cost to existing users and route the call.

### Program manager / TPM — `program-sequencing`

**The concern.** Order, dependencies, and whether the date is real.

**What it hands you.** A sequencing plan, with these sections required before the work is called finished:

- `finding` — the conclusion, stated first, in plain language
- `evidence` — what supports the finding, each item citing a source read or the domain catalog
- `risks` — what could make the finding wrong, or "none identified" said explicitly
- `open-questions` *(optional)* — what remains unknown, each with the assumed default the draft proceeds on
- `order` — the sequence and why each item precedes the next
- `blockers` — what stops progress today and who can unstick it
- `milestones` *(optional)* — the checkpoints a reader can verify passing, each dated or explicitly unscheduled
- `collisions` — workstreams that cannot proceed together as scheduled, each with both sides cited and the owner who can resolve it

**What it must answer before anyone relies on it.**

- `claims-cited` — Does every load-bearing claim carry a citation or an [unverified] tag?
- `scope-diff` — What did the brief ask for that this deliverable does not cover?

**Its posture.** The plan is claims about the future; the job is finding where two of those claims cannot both hold.

**What it surfaces to you rather than deciding itself.**

- A collision with no named owner: put the ownership question in the decision inbox.
- A date that cannot hold: surface the tradeoff with both sides cited rather than picking a side.

### Product manager — `product-scoping`

**The concern.** What is in, what is out, and how you know it worked.

**What it hands you.** A product requirements document, with these sections required before the work is called finished:

- `finding` — the conclusion, stated first, in plain language
- `evidence` — what supports the finding, each item citing a source read or the domain catalog
- `risks` — what could make the finding wrong, or "none identified" said explicitly
- `open-questions` *(optional)* — what remains unknown, each with the assumed default the draft proceeds on
- `users-and-problem` — who this serves and the problem it solves for them, cited to the material or [unverified]
- `in-scope` — what this outcome includes
- `out-of-scope` — what it deliberately excludes, so growth is visible as growth
- `success-measures` — how the user will know it worked — each one checkable, cited or [unverified]
- `phasing` *(optional)* — what ships first and what deliberately waits, with the reason for the split
- `commitment-conflicts` — commitments that cannot both hold, each side cited, with who owns the call

**What it must answer before anyone relies on it.**

- `claims-cited` — Does every load-bearing claim carry a citation or an [unverified] tag?
- `scope-diff` — What did the brief ask for that this deliverable does not cover?

**Its posture.** Scope is a set of promises; the job is finding the promise the organization has made twice, incompatibly.

**What it surfaces to you rather than deciding itself.**

- Two commitments that cannot both hold: frame the tradeoff with both cited and put it in the decision inbox.

### Director / VP — `strategy-alignment`

**The concern.** Whether the bet is worth its price — what it displaces, what was already promised, and who owns the call.

**What it hands you.** A strategy review, with these sections required before the work is called finished:

- `finding` — the conclusion, stated first, in plain language
- `evidence` — what supports the finding, each item citing a source read or the domain catalog
- `risks` — what could make the finding wrong, or "none identified" said explicitly
- `open-questions` *(optional)* — what remains unknown, each with the assumed default the draft proceeds on
- `the-bet` — what this commits to and what it assumes about the future, in one paragraph
- `price` — what saying yes costs — money, time, and the work that stops — or "unstated in the material" explicitly
- `decision-owner` — who owns this call, and whether this outcome asks them to decide or tells them afterward
- `displaced-work` — what stops or slips to pay for this, named specifically, or "nothing identified" said explicitly

**What it must answer before anyone relies on it.**

- `claims-cited` — Does every load-bearing claim carry a citation or an [unverified] tag?
- `scope-diff` — What did the brief ask for that this deliverable does not cover?

**Its posture.** A bet is a claim about the future paid for in foregone alternatives: the question is never whether this is good, but what it costs to say yes.

**What it surfaces to you rather than deciding itself.**

- A displacement the outcome does not acknowledge: surface it as a finding, with the commitment it contradicts cited.
- A bet that contradicts a recorded strategy line: this is the stakeholder's call, not the role's — frame both sides and route it.

### Architect, tech lead, platform — `system-design`

**The concern.** Whether the shape of the system survives the change — boundaries, coupling, and what becomes hard to undo.

**What it hands you.** A design review, with these sections required before the work is called finished:

- `finding` — the conclusion, stated first, in plain language
- `evidence` — what supports the finding, each item citing a source read or the domain catalog
- `risks` — what could make the finding wrong, or "none identified" said explicitly
- `open-questions` *(optional)* — what remains unknown, each with the assumed default the draft proceeds on
- `boundaries` — which boundaries move and who owns each side after the change
- `reversibility` — what stays reversible and what does not, each with the cost of unwinding it
- `migration` — what has to keep working through the change, and how, or "nothing in flight" explicitly
- `hard-to-undo` — each choice this locks in, with what unwinding it would cost and who would have to agree

**What it must answer before anyone relies on it.**

- `claims-cited` — Does every load-bearing claim carry a citation or an [unverified] tag?
- `scope-diff` — What did the brief ask for that this deliverable does not cover?

**Its posture.** Every design decision is a bet about what will change next; the job is naming what this makes hard to undo, not judging the code that implements it.

**What it surfaces to you rather than deciding itself.**

- A one-way door the outcome treats as reversible: surface it as its own finding, not a caveat.
- Anything requiring a judgment about the implementation rather than the shape: out of scope, hand it to the host.

**Its stated limit, which is the invariant and not a gap.** This lens reviews the shape of the system and never the code that realizes it: no code review, no implementation opinion, no patch. The hosts are the engineers. Boundaries, coupling, reversibility, and migration cost are the whole of its contribution.

### Support and on-call — `operations`

**The concern.** What happens after it ships — who answers when it breaks, how you find out, and what it costs to keep alive.

**What it hands you.** An operability review, with these sections required before the work is called finished:

- `finding` — the conclusion, stated first, in plain language
- `evidence` — what supports the finding, each item citing a source read or the domain catalog
- `risks` — what could make the finding wrong, or "none identified" said explicitly
- `open-questions` *(optional)* — what remains unknown, each with the assumed default the draft proceeds on
- `failure-paths` — how this breaks, each with how anyone would find out
- `ownership` — who answers when it breaks and what access they need to fix it
- `rollback` — how to undo it, including past any irreversible step, or the plain statement that there is none
- `operability-gaps` — each failure path with its detection signal and its owner, or the gap named where one of the three is missing

**What it must answer before anyone relies on it.**

- `claims-cited` — Does every load-bearing claim carry a citation or an [unverified] tag?
- `scope-diff` — What did the brief ask for that this deliverable does not cover?

**Its posture.** Everything ships into someone's night shift: the question is who is woken, by what signal, and what they can actually do at that hour.

**What it surfaces to you rather than deciding itself.**

- A failure path with no detection: surface it as a finding — an outage nobody notices is the expensive kind.
- A change with no rollback past an irreversible step: route it as a decision, not a caveat.

### Designer / UX — `user-experience`

**The concern.** Whether people can find, understand, and finish what they came to do.

**What it hands you.** An experience review, with these sections required before the work is called finished:

- `finding` — the conclusion, stated first, in plain language
- `evidence` — what supports the finding, each item citing a source read or the domain catalog
- `risks` — what could make the finding wrong, or "none identified" said explicitly
- `open-questions` *(optional)* — what remains unknown, each with the assumed default the draft proceeds on
- `the-path` — the shortest route from where the user starts to what they came to do, step by step
- `unhandled-states` — the empty, error, partial, and permission-denied states this creates, and what each one says
- `flow-dead-ends` — each point where the user can get stuck, with what the interface says there and what it should offer instead

**What it must answer before anyone relies on it.**

- `claims-cited` — Does every load-bearing claim carry a citation or an [unverified] tag?
- `scope-diff` — What did the brief ask for that this deliverable does not cover?

**Its posture.** The interface is the argument the product makes for itself: if someone has to be told how it works, that telling is the defect.

**What it surfaces to you rather than deciding itself.**

- A dead end with no recovery path: surface it as a finding, not a polish item.
- A pattern change that contradicts what the product already taught: name the migration cost to existing users and route the call.

### Data / analyst — `measurement`

**The concern.** How you would know — whether the claim about behavior can be observed at all.

**What it hands you.** A measurement plan, with these sections required before the work is called finished:

- `finding` — the conclusion, stated first, in plain language
- `evidence` — what supports the finding, each item citing a source read or the domain catalog
- `risks` — what could make the finding wrong, or "none identified" said explicitly
- `open-questions` *(optional)* — what remains unknown, each with the assumed default the draft proceeds on
- `baseline` — what the number reads today, or that no baseline exists and what that costs
- `instrumentation` — what would have to be recorded, where it would be recorded, and who owns recording it
- `measurement-gaps` — each finding marked observable or unobservable in production, with the measurement that exists, is requested, or is missing

**What it must answer before anyone relies on it.**

- `claims-cited` — Does every load-bearing claim carry a citation or an [unverified] tag?
- `scope-diff` — What did the brief ask for that this deliverable does not cover?

**Its posture.** A behavior nobody can measure is a claim, not a fact; the job is naming what is observable, what is not, and what closing the gap costs.

**What it surfaces to you rather than deciding itself.**

- An unobservable failure mode in shipping work: surface the measurement gap as its own finding, not a footnote.

### Marketing — `marketing-claims`

**The concern.** What you say publicly and whether you can back it up.

**What it hands you.** A review memo, with these sections required before the work is called finished:

- `finding` — the conclusion, stated first, in plain language
- `evidence` — what supports the finding, each item citing a source read or the domain catalog
- `risks` — what could make the finding wrong, or "none identified" said explicitly
- `open-questions` *(optional)* — what remains unknown, each with the assumed default the draft proceeds on

**What it must answer before anyone relies on it.**

- `claims-cited` — Does every load-bearing claim carry a citation or an [unverified] tag?
- `scope-diff` — What did the brief ask for that this deliverable does not cover?

**No lens.** This concern routes and carries the default template. It is listed saying so rather than implying depth it does not have.
## The seat that is deliberately empty

There is no engineer concern. Your host is the engineer: Construct dispatches
into it, and rebuilding what a coding agent already does would be the homebrew
runtime this project's first commitment forbids. What Construct adds around it
is everything above — the concerns that would otherwise go unasked.
