---
name: intake
description: Turns a long, messy, nonlinear request - several concerns,
  corrections, and implied outcomes in one message - into an execution plan
  without asking the requester to restate it more cleanly. Extracts the
  primary outcome, explicit and implied constraints, decisions already made,
  and supersessions; keeps tangents visible in a parking lot instead of
  chasing or discarding them; proceeds on safe, labeled assumptions and asks
  only what genuinely blocks. Use when a request arrives as a brain dump, a
  meeting's worth of threads, a forwarded conversation, or any message where
  the asks outnumber the sentences that state them - before starting work on
  any of it. Not for a clear single-outcome request - just do that - and not
  for a message that is thinking out loud with no ask yet, where the right
  response is engagement, not a plan.
license: Apache-2.0
metadata:
  version: 0.2.0
  source: geraldmaron/construct
---

# Intake

A working method for the moment a messy request arrives. It exists because
the two default behaviors of a capable model at that moment are both bad,
in opposite directions: either seize the first actionable-looking sentence
and run with it, dropping the other four concerns the message carried - or
bounce the mess back ("could you clarify what you'd like me to focus
on?"), making the requester do the structuring that was the assistant's
job. The premise this method rests on: a messy request is intentional
signal, not disorder to fix. The requester wrote it the way they think.
The structure is in there; extracting it is work, and the work belongs on
this side of the conversation.

Every step below is mandatory when this skill is engaged. The plan is a
draft until its verification record is complete.

## 1. Scope - and when to stand down

Engage this method when a request carries several concerns, corrections,
or implied outcomes at once - a brain dump, a forwarded thread, notes from
a meeting, a message whose asks outnumber the sentences stating them - and
work is about to start on it.

Stand down when it does not. A clear request with one outcome gets done,
not processed - running intake on "fix the typo in the header" is
ceremony, and a method that always interposes teaches the requester to
ignore it. Stand down differently when the message is thinking out loud:
no ask has formed yet, and the right response is engagement with the
thinking - questions, reactions, the missing consideration - not a plan
for work nobody requested. If it is genuinely unclear whether an ask
exists, say what you read as the ask in one sentence and let the requester
correct it - that is one question, not a bounce-back.

## 2. The extraction pass

Read the whole message before structuring any of it - supersessions (below)
make early conclusions wrong. Then extract into labeled lists:

- **Primary outcome** - the one thing that, delivered, makes the requester
  say the request was handled. There is almost always exactly one; when two
  genuinely tie, say so and name the tiebreak used. The primary outcome is
  often not the first thing mentioned, and stating it is the single highest-
  value sentence in the plan.
- **Secondary outcomes** - asked for, real, and subordinate. Delivered
  after, or alongside if cheap.
- **Explicit constraints** - stated limits: deadlines, tools, budgets,
  "don't touch X", "must work with Y".
- **Implied constraints** - limits the message carries without stating:
  the requester's evident expertise level sets the register; the mention of
  an environment implies compatibility with it; a complaint about a past
  approach is an instruction not to repeat it. Each implied constraint is
  written down as one, because unstated-but-real constraints are where
  plans quietly go wrong.
- **Decided** - decisions the message already made ("we're going with B",
  "I already told them yes"). Recorded and built on, never relitigated. A
  plan that reopens a decision the requester already made is the intake
  failing.
- **Supersessions** - where the message corrects itself ("actually, skip
  that", "on second thought"). The last statement wins; the superseded
  version is noted as superseded, not silently deleted, so the requester
  can see their correction was caught.

Anything the plan leans on that the message does not settle is an
assumption, marked `[assumed]`, with the safe default chosen and labeled.
Safe means reversible: an assumption whose wrong guess would be expensive
to undo is not assumed - it goes to the blocker list.

## 3. The parking lot

Tangents - ideas, gripes, asides, futures - are kept visible in a parking
lot, one line each, verbatim enough that the requester recognizes them.
They are never discarded (the requester put them there on purpose) and
never chased (they are not the ask). A parking-lot entry that later turns
out to be load-bearing gets promoted, and the promotion is stated. The
parking lot is what makes it safe to not do something: it proves the thing
was heard.

## 4. Blocker honesty

A question goes to the requester only if the answer would change what is
built AND the answer cannot be found in the message, in held material, or
by one bounded look. Everything else proceeds on labeled assumptions (§2).
The blocker list ships with the plan, each entry naming exactly what is
needed and what starts moving the moment it arrives. Zero blockers is the
common, honest case; a plan with five questions attached is usually an
extraction pass that stopped early.

## 5. The plan shape

The output is exactly this shape:

```
Intake
- Primary outcome:   <one sentence>
- Also wanted:       <secondary outcomes, one line each; or none>
- Constraints:       <explicit and implied interleaved, implied ones marked (implied)>
- Decided:           <already-made decisions the plan builds on; or none>
- Superseded:        <corrections caught: "<late statement>" replaces "<early>"; or none>
- Assumptions:       <each [assumed], with its safe default; or none>
- Parking lot:       <tangents kept visible, one line each; or empty>
- Blocked on you:    <only true blockers; or nothing — proceeding>
- Plan:              <numbered steps, critical path first>
```

The order of the plan's steps follows dependency and risk, not the order of
mention in the request. Cheap, reversible steps that de-risk later ones move
early.

## 6. The readback rule

When the cost of misreading the request exceeds the cost of a pause - the
work is long, expensive, or hard to reverse - the intake block (§5) is
stated back to the requester before heavy execution, framed as "this is
what I'm doing, correct anything wrong", not as a question. Work that is
cheap and reversible starts immediately; the intake block travels with the
result instead. Which mode was chosen is stated, in one line, so the
requester knows whether work is already underway.

## 7. The closing gates

Before work proceeds (or the readback ships), each gate is answered - work
shown, not work claimed:

1. **Whole message read** - supersessions caught; the last statement wins
   everywhere it conflicts (§2).
2. **One primary outcome** - stated in one sentence; ties named and broken
   (§2).
3. **Implied surfaced** - implied constraints written down as constraints,
   marked (§2).
4. **Nothing relitigated** - every decided item is built on, not reopened
   (§2).
5. **Tangents kept** - the parking lot holds every aside the message
   carried; nothing chased, nothing dropped (§3).
6. **Blockers earned** - every question to the requester passes §4's two
   conditions; everything else proceeds on labeled assumptions.
7. **Mode stated** - proceeding now vs. readback first, chosen by
   reversal cost, said in one line (§6).

## 8. The verification record

The intake block ends with a short record, exactly this shape:

```
Verification record
- Whole message read: answered — supersessions: <n, or none found>
- One primary outcome: answered — see Intake block
- Implied surfaced:   answered — <n> implied constraint(s) written
- Nothing relitigated: answered — decided items: <n, built on>
- Tangents kept:      answered — parking lot holds <n>
- Blockers earned:    answered — <0 blockers, proceeding | <n>, each passes both conditions>
- Mode stated:        answered — <proceeding | readback first>, because <one clause>
```

A gate that was not done says `not done - <reason>` in its slot. It is
never deleted, never skipped silently.

The record is presence, not quality: whether the extracted primary outcome
is the one the requester meant is judgment, and the record never claims to
have automated it - the readback (§6) and the parking lot (§3) exist
precisely so the requester can catch it cheaply when it is wrong.


Two rules travel with this record wherever skills compose. When several
skills govern one deliverable, the skill that owns the deliverable's shape
produces its full record, and every other skill contributes exactly one
line to that same block - its name, then its verdict or a one-clause gate
summary - never a second full block, because stacked records are how
ceremony buries content. And every "see <where>" in any record carries a
short quoted fragment of what it points to, not a bare location - a
pointer that cannot quote its target is pointing at nothing, and the
fragment is what makes an empty answer visible to a reader who can only
check presence.

## 9. What is enforced, and by what

Nothing in this file is machine-enforced by this file. The extraction, the
gates, and the record are obligations on you, made checkable for the
requester - that visibility is the enforcement tier this skill carries
everywhere it goes. An environment that separately checks the record's
presence adds a deterministic tier on top; this file works identically with
or without one, and never claims a tier it is not running under.

## References

Method identified, not incorporated - these name where the discipline comes
from, and reading them is not required to follow it:

- Allen, *Getting Things Done*, 2001 - capture everything, decide the next
  action, park what is not actionable (§3's ancestor).
- Grice, "Logic and Conversation," 1975 - implicature: what a cooperative
  speaker means beyond what they state (§2's implied constraints).
- Gause & Weinberg, *Are Your Lights On?*, 1982 - the stated problem is
  rarely the problem; whose problem it is matters (§2's primary outcome).
- Schein, *Humble Inquiry*, 2013 - asking as intervention: every question
  costs the asker's standing and the answerer's time (§4).
