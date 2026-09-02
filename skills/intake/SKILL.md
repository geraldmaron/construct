---
name: intake
description: >-
  Turns a long, messy, nonlinear request into one structured brief: what is
  actually being asked, the constraints, what was already decided, the open
  questions. Use when the person says things like: so the thing from Tuesday
  plus what Raj said minus the pricing part; here are my notes, pull out
  what they asked for; five messages saying different things, what do they
  want; turn this rambling memo into something the team can act on; make
  this a ticket. Not for a single clear ask.
license: Apache-2.0
metadata:
  version: 0.3.0
  source: geraldmaron/construct
---

# Intake

A working method for the moment a messy request arrives. Two default
failures: seize the first actionable sentence and drop the others, or
bounce the mess back for the requester to structure. A messy request is
intentional signal; extracting structure is work that belongs on this side.

Every step below is mandatory when this skill is engaged.

## 1. Scope - and when to stand down

Engage when a request carries several concerns, corrections, or implied
outcomes at once - brain dump, forwarded thread, meeting notes, asks
outnumbering sentences that state them - and work is about to start.

Stand down on a clear single-outcome request - just do it. Stand down when
the message is thinking out loud with no ask yet - engage the thinking,
don't invent a plan. If unclear whether an ask exists, say what you read
as the ask in one sentence and let them correct it. Applying nothing is a
designed outcome.

## 2. The extraction pass

Read the whole message before structuring - supersessions make early
conclusions wrong. Extract into labeled lists:

- **Primary outcome** - the one thing that, delivered, means the request
  was handled. Usually exactly one; when two tie, name the tiebreak. Often
  not the first thing mentioned.
- **Secondary outcomes** - asked for, real, subordinate.
- **Explicit constraints** - stated limits: deadlines, tools, budgets,
  "don't touch X".
- **Implied constraints** - limits carried without stating (expertise
  level, environment, complaints about past approaches). Write each down
  as implied.
- **Decided** - decisions already made. Build on them; never relitigate.
- **Supersessions** - self-corrections. Last statement wins; superseded
  version noted, not silently deleted.

Anything the plan leans on that the message does not settle is
`[assumed]` with a safe (reversible) default. Expensive-to-undo guesses
are blockers, not assumptions.

## 3. The parking lot

Tangents stay visible, one line each, recognizable to the requester.
Never discarded, never chased. Promote if later load-bearing, and state
the promotion. The parking lot proves something was heard when not done.

## 4. Blocker honesty

Ask the requester only if the answer would change what is built AND cannot
be found in the message, held material, or one bounded look. Everything
else proceeds on labeled assumptions. Ship the blocker list with the
plan; zero blockers is the common honest case.

## 5. The plan shape

Exact skeleton: [references/plan-shape.md](references/plan-shape.md).
Steps follow dependency and risk, not mention order.

## 6. The readback rule

When misreading costs more than a pause (long, expensive, hard to reverse),
state the intake block back before heavy execution - "this is what I'm
doing, correct anything wrong." Cheap reversible work starts immediately;
the block travels with the result. State which mode was chosen in one
line.

## 7. Closing gates

1. Whole message read - supersessions caught; last statement wins.
2. One primary outcome - one sentence; ties named and broken.
3. Implied surfaced - written and marked.
4. Nothing relitigated - decided items built on.
5. Tangents kept - parking lot holds every aside; nothing chased or dropped.
6. Blockers earned - every question passes §4; else labeled assumptions.
7. Mode stated - proceeding vs readback, by reversal cost, one line.

## Closing record

When finalizing, use
[references/verification-record.md](references/verification-record.md).
Method sources: [references/sources.md](references/sources.md).
