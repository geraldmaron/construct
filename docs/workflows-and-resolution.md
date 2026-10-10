# Workflows and dependency resolution

A workflow is a versioned manifest: typed inputs, ordered DAG steps with
stable ids and `needs`, per-step skill and version range, capability
requirements, source and freshness requirements, an action tier, input
mapping from the run input or upstream outputs, declared outputs,
validators, retry and timeout, triggers, no-data and stale-data policies,
concurrency and deduplication, cancellation, a deliverable contract, and
what the workflow may propose afterwards.

## How a session picks a workflow

Construct does not read intent from the person's words. The host model
reads the request and reports its reading to `classify_request` as typed
fields: the kind of request (answer, remember, manage, maintain, or
coordinate), the person's words verbatim, the deliverable they want back
(a kind a workflow declares, a family such as `review` or `document`, or
`other` with a few words of description), and the period, the systems
named, the destination, the schedule, the stakes, and anything the
conversation leaves open. A kind outside that set, a missing deliverable for
work, or any other value Construct would have to guess comes back as wrong
input naming the field, the values it takes, and an example of that field.

Construct checks the reading, works the period out from the calendar,
resolves the named systems to declared source ids, and names every
workflow whose declared deliverable fits, in a fixed order: a workflow the
reading names, then the exact kind, then the rest of its family, with
workflows that bind the chosen skill first in each group. `other` goes to the
general carrier, `managed-outcome`, then the workflows that bind the chosen
skill; for maintain those come first and the carrier last, when it can be
scheduled. Manage work nothing else fits also goes to the carrier. Maintain
work nothing fits gets no match, and the host is told to offer to run it
once now instead. Each match comes with whether it can run here, what it
still needs, and the use-when text of the skills it binds. Construct asks
only what it can see is missing: a required input of the first match, a
schedule for maintain, which declared source an ambiguous name means, or
where the result goes when two destinations disagree. The host's own
blocking items go back to it to ask. Nothing is recorded.

The result also says how much rigor the work gets: light, standard, or
challenged. The workflow's structure sets the floor: a workflow that
declares its deliverable must be challenged, a step whose action tier is
`external_write` or higher, or an open contradiction against a governing
decision or requirement. The stakes the host declares (hard to undo, or
what the work touches), the chosen method, and the request's words only
raise it, and a raise from the words is labeled "(lexical)". A private
helper rename raises none of these. Any raise means challenged: `claim_work`
says so and why, and acceptance is refused until a challenge is recorded.
With nothing raised, a side project gets light rigor and every other
project, including one whose scale is not answered, gets standard. The
same judgment is read at preflight, in the claim packet, on resume, at
submit, and at acceptance.

`start_outcome` takes the same intake and checks it again, so skipping
`classify_request` skips no check. While a question is open or an input is
wrong, nothing starts and no run is left behind. A workflow the reading did
not match is refused, and the refusal lists the ones it did match. Otherwise
the run freezes the reading in its bindings, once: the intake, the period
in dates, the named and declared sources, the stakes and the chosen method
as declared, who judged the reading, and what was assumed. Every step is
handed the reading in structured fields, without the person's words;
Construct's own instructions count the systems that are not registered and
never name them. A review step that binds no skill of its own is given the
chosen method. The same target over a different window is different work.
The command line and standing triggers start through the same service and
still keep a blocked run to correct.

## Resolving before running

```bash
construct workflow list
construct workflow show design-conformance
construct workflow resolve design-conformance --input=target=src
construct workflow validate
```

Resolution fails before execution for a missing skill, workflow, capability,
or source; an incompatible version; a dependency cycle; a missing step
input; an output-to-input mismatch; an unknown action tier; a capability the
host does not provide; a step above the executor's tier; a load-bearing
output with no validator; a stale or unreachable mandatory source; an
ambiguous executor; or a diverged lock. Every result explains why the
workflow is runnable, blocked, outdated, or divergent, with a remedy per
reason. Nothing chooses a "close enough" skill, source, or version.

## Running

```bash
construct workflow run design-conformance --input=target=src --dry-run
construct workflow run design-conformance --input=target=src
construct run list
construct run show run-0001   # exits 1
```

A run is created once per idempotency key derived from the workflow's
dedupe fields. Its steps are leased to whoever executes them, the person's
session through the broker or a configured runner, with a fencing token; a
lost lease is reclaimed after expiry without repeating finished work. Every
step is gated through the policy engine; a step that needs an approval
raises one question scoped to exactly that action and the run waits. Every
submission runs the step's validators; a failure comes back with what to
fix and the step is retried by its policy. A load-bearing step that still
fails after its last attempt waits on the person instead of failing the
run: accept it with the named problems, give it another attempt, or stop. A
waiver covers only the checks its question named, records who answered and
on which channel, and the run's deliverable is never marked validated.
Steps that declare the kernel's own drift capability are run by Construct
itself. A run keeps the workflow version, digest, and steps it started
with. When the workflow, or a skill bound to one of its steps, changes while
the run is in flight, claiming its next step says to re-resolve instead of
going on under the new definition.

Checks fail closed. A step's declared outputs are the contract its
validators check: `schema` and `deliverable_complete` need every declared
key present, and `deliverable_complete` refuses an empty one.
`verification_result` refuses `passed: false`, a failing exit status
recorded as passed, a null artifact, an empty result, no command, result,
or passed flag at all, evidence from an old revision of the subject, and
unresolved references. `review_complete` needs the subject, the revision
reviewed, and a method or reviewer.

A step that returns `blockers`, such as a plan's questions that only the
person can answer, raises them as one question for the person, answered in
their own words, and the run waits: claiming work returns that question
instead of the next step until it is answered. Every later step receives each question with its
answer, who gave it and how it reached Construct, under `answers` in its
inputs. The answer is kept on the question, so the run's input stays as it
was given and the run can be started again with it. A deliverable is not
accepted or made final while its run still has such a question open, and the
acceptance prompt quotes any answer the assistant relayed for the person.

The `run show` line above expects exit code 1 because no run with that id
exists in a fresh project; a real id comes from `workflow run --json`.

```bash
construct run cancel run-0001   # exits 1
construct run resume run-0001   # exits 1
```

## Typed inputs

Besides strings, numbers, booleans, string lists and objects, a workflow
input may be declared as one of two types Construct checks itself.

- `period`: the time the work covers. It is an object with `semantics` and
  exactly one way of naming the time. `semantics` is `as_of` (things as they
  stood at the end of a day), `changed_during` (what changed inside a
  window), or `evidence_window` (evidence dated inside a window). The time is
  `relative` (`this_week`, `last_week`, `this_month`, `last_month`,
  `this_quarter`, `last_quarter`, `this_year`, `last_year`, `year_to_date`,
  or `last_n_days` with `n` from 1 to 3660), a `quarter` from 1 to 4 with or
  without a `year`, a `year` alone, or `from` and `to` as YYYY-MM-DD. It may
  also carry a `timezone` and a `phrase`, the person's own words. Dates may
  accompany `relative`, `quarter` or `year` only when they agree with them.
- `source_ids`: a list of declared source ids. An id that names no active
  source blocks the run, with how to declare it.

A malformed period, or one given as prose such as "Q3", blocks the run with
the shape it takes; a period left out that the workflow requires names its
slot in the reason. How a period is worked out:

- Weeks run Monday to Sunday, and quarters are calendar quarters.
- `this_week`, `this_quarter` and the rest name the whole unit, and say so
  when it ends after today.
- `year_to_date` runs from January 1 to today, and `last_n_days` counts
  today.
- A quarter without a year is the most recent one that has started: asked on
  2026-08-15, Q4 is the fourth quarter of 2025.
- `as_of` keeps only the end date; an end after today is taken as of today.
- Dates are in the period's own timezone, else the caller's (a trigger's for
  a firing), else UTC.

Every result lists what it took as given, such as "quarters are calendar
quarters", "dates are in UTC", or "Q3 taken as 2026". The period is worked
out once, when the run is created, and frozen on the run: the run's input
keeps the period as it was given, every step that reads the period input
receives the dates, every step is told what the run covers and which sources
it names, and `run_status` shows both. Resuming, retrying, or answering a
decision never moves the window.

A period is part of the work's identity by what it means: its semantics,
dates, and timezone. `last_quarter` asked on two days of one quarter, or
`quarter` 3 with `year` 2026, is the same run; another window or another
semantics is different work. Source ids count as a set. A start that finds
the work under way says which inputs it gave differently, and a start whose
period was refused is replaced by the corrected one. For a finished period,
a named source never read here, or last read on a day before the period
ends, is flagged at start so it can be read; the flag never blocks.

Evidence is checked against the period. A step that names `within_period`
refuses a cited item whose recorded update falls after the period ends,
under every semantics, unless the output lists it under `outsidePeriod` as
`{ref, why}` with why it belongs. An item last updated before the period
starts, an item with no date, and a project file are never refused. A step
that names `named_sources_read` needs something cited from each source the
run names (an item, a file, or a folder inside it; naming the whole source
does not count), or the source listed under `unread` as `{source, why}`.
The deliverable states the period it covers with its coverage: which
citations fall inside it, before it, or after it, which are undated
(project files count here, since they are read as they stand now), and the
`outsidePeriod` entries the run's steps gave for citations after it. It also states which named
sources something was cited from and which were listed as unread.
`check_answer` takes the same period for a plain answer.

A manifest declares at most one period input, since a run covers one
period, and a non-empty `dedupeKey` must include every `period` and
`source_ids` input, since work for a different period or sources is
different work. When a period input is declared, every step that checks
citations (`citations_present` or `evidence_refs_resolve`) must also name
`within_period`. [Recurring and scheduled operation](recurring-operation.md)
shows a trigger whose period moves with each firing.

## Deliverables and trust

The last step, and any step that declares `challenge`, leaves a draft. The
deliverable becomes validated only when the last step has checks, every one
passes, and nothing in the run went through on a waiver; `promote_deliverable`
cannot set it. Acceptance and finality are recorded transitions the
person's judgment drives through the host. A task being done never implies
its deliverable is trusted.

A challenge is recorded with `promote_deliverable` (to `challenged`) and
takes `objections`: each objection it raised and what was done about it
(fixed, accepted, rejected, or open). An empty list says it found nothing.
It is recorded by the host, not asked of the person. Work whose rigor is
challenged, as described under how a session picks a workflow, cannot be
accepted until its challenge is recorded.

The last step hands the deliverable back. Its body is what that step
returned plus every input the step was handed (from the run's input or
earlier steps), so the last step returns only what it adds. A handed value
wins over a restatement; a restated key whose value differs stays in the
step's own record, and `submit_work` names it under `ignored`. The body
also carries the last step's evidence, the sensitivity of what the run
cited (null when nothing cited carries a label), how many citations come
from no declared source, so that their sensitivity is unknown
(`sensitivityUnknown`), how many of the run's citations Construct opened
itself or holds only as the host's report (`provenance`), every check the
run went through on a waiver, with who accepted it and how (`waived`), and,
when the run covers a period or names sources, its coverage of both.

Accepting a deliverable, or making it final, is the person's own answer.
The question they are asked starts with the move, from the trust the
deliverable holds now. Then come the facts Construct holds, one per line:
the checks waived and whether the person or their assistant answered, the
checks that passed, how many of the things it rests on Construct opened,
how many are the assistant's report and how many could not be checked, any
verification the assistant reports running (Construct runs none), the
highest sensitivity cited and how many citations have no known
sensitivity, the sources the assistant declared, the systems the request
named that are not registered, where the citations fall against the
period and the named sources, and the challenge record. The assistant's
own words come last, under "Your assistant's description, not
checked by Construct:", each quoted on one line and cut at 160 characters:
its assumptions, why it kept an item dated after the period or could not
read a source, open objections, the destination it named, and the request
as it relayed it. The question is cut at 1,500 characters, and a cut one
ends with `(more: construct inbox show <id>)`, which prints the whole. When
the deliverable has changed since an open question was asked, asking again
withdraws that question and asks a current one. An approval of the older
question, relayed or the person's own, moves nothing: a relayed one puts
the current question to the person instead, and the person's own answer
(`construct inbox resolve`) is refused with the id of the current question.

The general carrier, `managed-outcome`, runs plan, do, and verify for any
outcome no other workflow names. It takes the request, a target, a period,
and source ids. Its do step returns the summary, findings, the files it
changed, and `artifact` (the file it produced, or null), and is checked for
citations, the period, the named sources, grounded figures, and the files
it says it wrote. Its verify step runs the project's own checks and hands
the outcome back.

## Built-in workflows

Project bootstrap and constitution review, minimal remember, managed
outcome with verification, design-principle conformance review, source
freshness and drift review, adversarial deliverable review,
strategy-to-execution and capacity review, the standing review wrapper, one
review per professional pack, PRD, RFC, and proposal authoring, a research
brief, revising a deliverable, and publishing one. See [catalog.md](catalog.md).

### Clock and executor are separate

`workflow fire` uses a headless capability profile. Without an executor it
records the tick and blocks model work with the missing capabilities. A ready
run is not completed work. `workflow executors` reports unattended support
for every interactive host; only the explicit local Codex CLI adapter is
currently implemented. Other hosts retain interactive MCP support and report
an unprovisioned unattended adapter rather than falling back to another host.

`workflow fire <trigger> --execute=codex --key=<tick>` probes the installed
host and authentication, launches one bounded host invocation with the runner
MCP surface, and inspects durable run state afterward. The model and sandbox
belong to the host. This adapter exposes local project files and Construct;
external MCP/API connectors are not automatically provisioned into it.
It does not choose a model, install a clock, publish, or answer a decision.
After the owned process group stops, its abandoned leases are fenced so the
same firing key can resume unfinished work. A successful host exit alone
never counts as a completed run.

Recipes require `--executor=codex` and the same persistent project state.
Cron needs Node/npm, an authenticated host and a CRON_TZ-compatible clock.
GitHub Actions recipes target an explicitly provisioned self-hosted runner,
use the trigger's IANA timezone, and do not imply that a fresh checkout contains
the ignored trigger database. Inspect and provision the recipe before
installing it. No clock continues merely because an agent session once ran.
