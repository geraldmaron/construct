# What a deliverable sounds like

This file is the reference for Construct's voice: one worked example of the
kind of deliverable Construct returns, written the way the voice asks for.

It was written by hand as an illustration, not produced by a live model run.
Nothing here is a measurement, and the run id and the findings below are
invented for the example. The rules it demonstrates live in
`src/kernel/voice/voice.ts` and reach every prompt that produces reader-facing
prose — role assignment, composition, closing, and Construct's own call —
before any work happens. The privacy concern framed which questions were asked
and whose name the work carries. It did not write in a different register.

---

## The outcome

> Launch a paid beta to EU users next month

Construct answered in the name of privacy because a model read that sentence
and gave its reason: EU users means GDPR obligations apply before launch, not
after. The deliverable names that concern. The prose is Construct's.

---

## The deliverable

**This launch needs a lawful basis for processing and a data processing
agreement with every subprocessor in the path, and neither exists yet as far as
I can see from the outcome alone.** Nothing here says the launch cannot happen
next month. It says two documents have to exist before the first EU user signs
up, and both take longer to get than people expect.

Here is what I looked at and what I found. The outcome names three things that
matter to my concern: paying customers, EU residency, and a date. Paid changes
the picture, because a free trial can sometimes lean on legitimate interest
while a billing relationship almost always rests on contract as the lawful
basis, and that choice has to be written down before processing starts rather
than reconstructed afterwards. EU residency brings in the transfer question:
if any part of the stack (analytics, error reporting, support tooling, the
payment processor) sits outside the EEA, that transfer needs its own basis,
usually standard contractual clauses plus a transfer impact assessment. The
date is what turns both of those from paperwork into schedule risk, because a
subprocessor's legal team sets the pace, not ours.

Two things are likely to be missed, and they are missed the same way every
time. The first is the subprocessor inventory. Teams tend to list the obvious
vendors and forget the ones a developer added in an afternoon, so the honest
version of this task is an inventory built from what the system actually calls
out to, not from memory. The second is the data subject request path. The
right of access and the right to erasure are not features you add after
launch: they are commitments that begin the moment the first record exists, and
retrofitting deletion into a system that was not designed for it is where this
usually goes badly.

There are three things I cannot tell from the outcome alone, and I would rather
name them than guess. I do not know where the data will be stored or processed,
so I cannot say whether a transfer mechanism is needed at all. I do not know
whether the beta collects anything in the special categories (health, biometric,
political, religious, sexual orientation, trade union membership), which would
raise the bar considerably and likely require a data protection impact
assessment. And I do not know whether the company has a lead supervisory
authority or an EU representative already, which decides who is contacted if
something goes wrong.

One piece of context worth carrying: the GDPR gives a data subject one month to
receive a response to an access request [cite:GDPR Article 12(3)], and a
personal data breach must be reported to the supervisory authority within 72
hours of becoming aware of it [cite:GDPR Article 33(1)]. Those are the two
clocks that start on launch day, and neither can be negotiated afterwards.

What follows from all of this is a sequence rather than a blocker. Build the
subprocessor inventory from the running system, decide and record the lawful
basis for the paid relationship, get the data processing agreements moving
first because they depend on other people, and confirm the deletion path works
end to end before the first real account exists. If the answers to my three
open questions come back the way I expect, next month is achievable. If special
categories are in scope, it is not, and I would want to hear that from whoever
owns the data model rather than assume it.

STANCE: hold
BECAUSE: A paid EU launch needs a recorded lawful basis and signed processor
agreements before the first user, and I have no evidence either exists.
CITE: GDPR Articles 6, 28, and 44 (lawful basis, processors, transfers)

---

## Why it reads this way

The finding is in the first sentence, in bold, before any of the reasoning. The
rest is a story with an order to it: the situation, then what was found, then
what follows. It sounds like a person talking to a colleague, uses contractions,
and never reaches for a word chosen to sound official.

Notice what it does with uncertainty. The three unknowns get their own
paragraph, stated as plainly as the findings, because a gap named is worth more
to the reader than a confident sentence covering it. The two legal deadlines
carry `[cite:...]` markers, which is the same notation the deterministic
no-fabrication check in `src/kernel/verify/claims.ts` reads. Anything with a
number, a date, or an amount either carries a citation or is marked
`[unverified]`, and an untagged claim comes back to the role.

The punctuation is ordinary. There are commas, colons, and parentheses doing
the work, and em dashes are close to absent rather than setting the rhythm. The
language does not assume anything about the reader, and where a person appears
they are described by their role in the work.

The stance block at the end is not part of the voice. It is the separate
protocol every role ends with, so a deliverable can disagree with another one
on the record.
