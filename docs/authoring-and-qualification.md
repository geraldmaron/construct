# Authoring and qualifying skills and workflows

## A skill

A skill is a directory: `SKILL.md` (Agent Skills frontmatter and body),
`construct.skill.json`, and optional `references/`, `assets/`, `scripts/`,
`schemas/`, and `evals/`. The manifest declares id, title, semantic version,
category, owner, activation and stand-down phrases, interaction classes,
outcomes and deliverable types, inputs and output schemas, required source
types and minimum evidence, capabilities (never tools), action tiers,
versioned skill and workflow dependencies, quality gates, escalation,
licensed-review boundaries, observations (which may not claim success
without naming a run), and eval files. Name and version must agree with the
frontmatter.

Bundles are digested in path order; content that changes without a version
bump fails `npm run lint` through the registry index check.

Project-authored skills live under `.construct/skills/` and may not shadow a
built-in id.

## Evals

`evals/activation.json` lists requests in ordinary language with the
expected outcome, activate or stand down. The activating cases do double
duty: they are fixtures, and the router retrieves over them, so every case
you add teaches Construct one more way a person phrases the need. Write
them the way people talk, not the way the manifest does.

The router does not decide which skill loads; the host model does. The
router orders every skill by how well the person's words match its
description, its activation phrases, and its labeled cases, and hands the
banded list back through `classify_request`; that ranking is lexical and is
labeled so. Its regression floors run on a frozen copy of the catalog
(`tests/fixtures/router-catalog.json`) and held-out requests
(`tests/fixtures/router-cases.json`), so they test the router's code and
never fail a description edit. A routing case is never copied into a
skill's own eval file, or the measurement stops being held out.

Whether hosts read requests well is measured through real hosts, not by
word overlap. The held-out corpus, `skills/evals/intake.json`, holds
requests in ordinary language, some with earlier turns, each labeled by two
model families with the readings either would accept. A hash of each case
puts it in the tune or the test split; descriptions are tuned only on the
tune split. `npm run evals:live -- run` drives Claude Code, Codex, and Cursor
one request at a time against a sterile project, with Construct alone, among
competing servers (on Claude Code also with tool search off), after a
first-run init, and with a page that carries planted instructions. `npm run evals:live -- record` writes
`skills/evals/intake-live.json`, scored by the rule fixed in code before any
test-split run. The suite validates a committed record and recomputes its
verdicts from the stored outcomes; `npm run evals:live -- check` fails when
the record is missing, does not cover the current cases, or was made against
different model-facing text (server instructions, tool descriptions and
schemas, the operational skill, or skill and workflow text), so changing any
of them means running it again. Neither the corpus nor a record is committed
yet; until one is, `check` says that no record exists.

Professional packs add `evals/fixtures.json` with positive, negative, edge,
and adversarial cases, and `references/sources.md` with citations, what each
is used for, and review dates; a build that did not re-open a source says so.

## A workflow

A workflow is a directory with `workflow.json`: id, title, semantic version,
purpose, activation and stand-down, interaction class, input schema and
required inputs, steps (id, title, needs, skill and range, capabilities,
sources with freshness, tier, inputs mapped from `input.<key>` or
`steps.<id>.<output>`, outputs, validators, load-bearing, challenge, retry,
timeout), triggers, no-data and stale-data policies, concurrency, dedupe
key, cancellation, deliverable contract, and what it may propose. A step
that reads an upstream output must list that step in `needs`; a load-bearing
step must name a validator; a step may not need itself.

An input may be typed `period` or `source_ids`, which Construct checks and
works out itself ([typed inputs](workflows-and-resolution.md#typed-inputs)).
A manifest declares at most one `period` input. A non-empty `dedupeKey`
must include every `period` and `source_ids` input, since work for another
period or other sources is different work. When a `period` input is
declared, every step that names `citations_present` or
`evidence_refs_resolve` must also name `within_period`, so every citation is
checked against the period. A manifest that breaks one of these rules does
not load.

The last step's mapped inputs travel into the deliverable under the names
the step reads them by, so a last step declares as outputs only what it
adds. An output it also reads as an input is its own to restate, and the
handed value is the one the deliverable keeps.

Project-authored workflows live under `.construct/workflows/`.

```bash
construct workflow validate
```

## Qualification

A skill or workflow is qualified when: the manifest validates and agrees
with its frontmatter; the registry index is current; its activating cases
rank first when held out and the routing floors still hold; its fixtures
cover the four kinds; a consuming workflow
resolves against it; and, for anything called working on a host, the
conformance command recorded the run.

## Grounding and quality checks

Validators are floors under quality, not a judge of it. The ones that
check grounding resolve every reference against the project as it stands:
a real file, a deliverable, a record Construct keeps, a declared source, or
an item a recorded read holds. Every resolved reference has one of three
provenances:

- witnessed: Construct opened it (a project file, a directory source) or
  keeps the record itself;
- reported: a recorded read holds that exact item, with the text the host
  said it read;
- unverified: it names something only the host can read that no recorded
  read holds. It resolves only when `policy.hostReads` is accept.

Every submission says how many citations were witnessed, reported,
unverified, or unresolved, and a validated deliverable records the same
counts.

| Validator | Sends back an output when |
|---|---|
| `citations_present`, `evidence_refs_resolve` | a reference names nothing this project holds |
| `excerpts_match` | a quoted excerpt is not in the file or item it cites |
| `evidence_recorded` | nothing cited holds content Construct can check (a project file, or an item whose text a recorded read holds) |
| `artifacts_exist` | the file the step says it wrote is missing or empty, or it names none (a step that declares `changes` may list none) |
| `numbers_grounded` | a figure in the output, or in a document the step wrote, appears in no text Construct holds for something else that was cited, and is not derived by arithmetic that holds over cited figures |
| `template_conformance` | the artifact lacks a section the named template has |
| `conflicts_declared` | there is no conflicts list, or a conflict cites fewer than both sides |
| `superseded_acknowledged` | a superseded document is used without saying so |
| `decision_ask_present` | a proposal has no decision section naming who decides and by when (a `decisionBy` date such as 2026-10-16 is found as written or as "October 16", "Oct 16" or "16 October") |
| `sources_diverse` | research rests on fewer than two independent places that hold content (pages of one website count once) |
| `within_period` | a cited item was updated after the period the run covers ends, and the output does not list it under `outsidePeriod` with why it belongs |
| `named_sources_read` | a source the run names has nothing cited from it, and the output does not list it under `unread` with why |

Construct does not fetch web pages. A web page resolves only once its read
is recorded: the host declares a source for the open web (one named `web`,
kind `other`), reports the page under it with its url and the text it
read, and a citation of that url then lands on the recorded item. An
excerpt is checked against held text and never grounds a figure on its
own; a citation with no held text (a whole source, one of Construct's own
surfaces such as `project_context`) supports nothing. Figures are compared
by value, allowing for how they were rounded ("2M" is supported by a cited
2,100,000; "3M" is not), dates and times are not figures, and a figure the
person gave in the request is theirs, not invented. Cited text is read
more loosely than an output, so configuration grounds the figures it sets:
`postgres:16` in a cited compose file grounds "Postgres 16", and
`"8080:8080"` or `PORT=8080` grounds port 8080. Dates, times, years, lone
digits, one group of "1,600", and digits inside an identifier (`PAY-420`,
`pull/311`, a commit hash, `v1.25.3`) give no figures. Only
documents a step wrote are read for figures: its artifact and its changed
files when they are documents (`.md`, `.mdx`, `.markdown`, `.txt`, `.rst`,
`.adoc`, `.html`, `.htm`, `.csv`, `.tsv`, `.mmd`). Code and configuration
are not, whether changed or named as the artifact, since their ports and
limits are the change itself, and citing a changed code file grounds what
the output says it now holds. A document a step wrote never grounds its
own figures, even when the step cites it through a link or in another
letter case. A `{path, removed: true}` entry in `changes` names a file
that is gone and is not looked for. A symlink that leads out of the
project does not resolve.

When a load-bearing step still fails its checks after its last attempt,
the run is not failed and the work is not thrown away: the person is asked
to accept it with the named problems, give it another attempt, or stop. An
accepted waiver is recorded on the step, and a deliverable that went
through one is never marked validated.

The `prd-authoring`, `rfc-authoring`, and `proposal-authoring` workflows
apply them in a gather, draft, challenge, record sequence; `research-brief`
answers a question from the project and the web in a gather, synthesize,
challenge, record sequence and asks for at least two independent sources.
It also takes the period the question covers and the sources to read, and
checks its citations against both. What none of
them can tell is whether a grounded claim is the right claim; that is the
challenge step's and the person's.

## Plain answers and revisions

`check_answer` runs the citation, quote, figure, and supersession checks on
an answer before the host gives it, and records nothing. Given the period
the answer covers, it also flags a cited item updated after the period
ends, unless the call lists it under `outsidePeriod` with why it belongs,
and returns the period in dates. The operational
skill asks the host to use it whenever an answer states facts about the
project.

`revise-deliverable` revises an earlier deliverable for a stated change and
keeps the two linked; `revision_linked` asks for the deliverable it revises
and a summary of what changed and why. When the person answers a stale-work
question with revise or re-run, `decide` returns the outcome that would do
it, for the host to offer; nothing starts on its own.

## Settled terms, sensitivity, publishing, and skill impact

`remember` with `contradicts` turns the terms a decision rules out into
constraints ("Do not state \"exactly-once\" as current"), and
`settled_not_contradicted` sends back answers and drafts that state them
as current without saying they were decided against. A deliverable records
the highest sensitivity among the sources its run cited;
`publish-deliverable` needs `clearedFor` from the person when that is
confidential or restricted, puts the write itself behind an action-time
approval, and records the location (`published_location`).
`construct skill impact` (and `project_context` topic `quality`) reports,
per skill version, how often its steps passed their checks first time,
mean attempts, waivers, and which checks sent them back. When the
constitution names owners and what each decides, the inbox shows who
decides each question and can be filtered to one owner.
