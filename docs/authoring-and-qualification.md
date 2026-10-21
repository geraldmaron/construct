# Authoring and evaluating skills and workflows

[Documentation index](README.md) · [Project README](../README.md)

## A skill

A skill is a directory: `SKILL.md` (Agent Skills frontmatter and body),
`construct.skill.json`, and optional `references/`, `assets/`, `scripts/`,
and `schemas/`. The manifest carries only what something
enforces: id, title, semantic version, category, owner, the capabilities a
host must provide (never tools), `maxTier` (the highest action tier a step
may apply the skill at), `requiredValidators` (validators the deliverable
must pass wherever the skill is bound), and versioned skill dependencies.
The resolver refuses a step above `maxTier`, a workflow whose
steps name none of a required validator, a missing capability, and a
missing or incompatible dependency; and the registry lock pins the version.
Any other key is refused: what the method
produces, its inputs, its evidence bar, and its limits and escalations are
the `SKILL.md` body's to say. Name and version must agree with the
frontmatter. When a skill applies is said once, in the `SKILL.md`
description, which the host model reads; a manifest that still lists
`activation` or `standDown` phrases is refused, because nothing reads them.

`npm run lint` also checks each shipped skill's `SKILL.md` against the
Agent Skills format (`scripts/lint-skill-spec.mjs`: only the format's six
frontmatter fields, a name equal to the directory, a description of at most
1024 characters, under 500 lines, no tracker ids or repository or absolute
paths) and against Construct's policy for method skills
(`scripts/lint-skill-policy.mjs`: a stand-down rule, and a warning above 350
lines). [`skills/AUTHORING.md`](../skills/AUTHORING.md) sets out the layers
of rules.

Bundles are digested in path order; content that changes without a version
bump fails `npm run lint` through the registry index check.

Project-authored skills live under `.construct/skills/` and may not shadow a
built-in id.

## Evals

Each skill is evaluated in the Agent Skills shape
([evaluating skill output quality](https://agentskills.io/skill-creation/evaluating-skills),
[optimizing skill descriptions](https://agentskills.io/skill-creation/optimizing-descriptions)):
output cases with checkable assertions, and should- and shouldn't-trigger
queries on a fixed train/validation split. Those evals, the intake corpus,
and the live-run harness are maintainer-local work kept in an ignored
`evals/` folder; they never enter git, the package, or an installed skill.

Nothing in Construct matches a request's words to a skill. The host model
reports its own reading to `classify_request`, which returns the workflows
whose declared deliverable fits and the use-when text of the skills they
bind, unranked, and the host model judges which skill applies. Whether it
judges well is shown only by running trigger queries against a real host.

Professional packs add `references/sources.md` with citations, what each is
used for, review dates, and the date each source was last opened and what was
confirmed there.

## A workflow

A workflow is a directory with `workflow.json`: id, title, semantic version,
purpose, interaction class, input schema and
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

Project-authored workflows live under `.construct/workflows/` and may not
shadow a built-in id.

```bash
construct workflow validate
```

## Lock integrity

The `skills` tool's show action reports whether a skill's bytes are the ones
the project locked: `current`, `unlocked`, `outdated`, `blocked`, `diverged`
(the same version with different bytes), or `missing`. That is integrity,
never quality: how well a skill works is shown by running its evals. A skill
cannot raise Construct's authority by anything its text says; the resolver
enforces each step's tier ceiling whatever the skill asks for.

Before a skill or workflow ships, its manifest validates and agrees with its
frontmatter, the registry index is current, its maintainer-local evals have
the standard shape, a consuming workflow resolves against it, and any effectiveness claim
rests on a recorded run of its evals. Static conformance checks protocol and wiring;
it cannot establish native effectiveness.

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
| `evidence_recorded` | nothing cited holds checkable content (a project file, a captured item, or a record whose text the resolver supplies) |
| `artifacts_exist` | the file the step says it wrote is missing or empty, or it names none (a step that declares `changes` may list none) |
| `numbers_grounded` | a figure in the output, or in a document the step wrote, appears in no text Construct holds for something else that was cited, and is not derived by arithmetic that holds over cited figures |
| `template_conformance` | the artifact lacks a section the named template has |
| `conflicts_declared` | there is no conflicts list, or a conflict cites fewer than both sides |
| `superseded_acknowledged` | a superseded document is used without saying so |
| `decision_ask_present` | a proposal has no decision section naming who decides and by when (a `decisionBy` date such as 2026-10-16 is found as written or as "October 16", "Oct 16" or "16 October") |
| `sources_diverse` | research has fewer than two locations with different held content (exact copies deduplicate; pages of one website count once); source independence remains unverified |
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
accepted waiver is recorded on the step with who accepted it and on which
channel. It covers only the checks its question named: a check that fails
anew is handled like any other failing check. A deliverable that went
through one lists its waived checks and is never marked validated.

The `authoring` workflow applies them in a gather, draft, challenge, record
sequence. Its domain selects requirements structuring for a PRD, decision
framing for a proposal, system architecture for an RFC, or investigative
research for a research brief. The research domain asks for at least two
distinct source locations with different held content (not verified independence) and takes an optional period and named sources; its
citations are checked against both. Proposal retains its required audience
and decision-ask check. Former authoring ids are refused; use `authoring` with
a declared domain. See [workflows and resolution](workflows-and-resolution.md#built-in-workflows).
What these checks cannot tell is whether a grounded claim is the right claim;
that is the challenge step's and the person's.

## Plain answers and revisions

`check_answer` runs the citation, quote, figure, supersession, and
settled-term checks on an answer before the host gives it. It starts
nothing and records only that a check happened and how it went. Given the
period the answer covers, it also flags a cited item updated after the
period ends, unless the call lists it under `outsidePeriod` with why it
belongs, and returns the period in dates. A citation that resolves only on
the host's word (`policy.hostReads` set to accept) is named in the result,
with the instruction to call the parts resting on it unverified or to
report the read with `sources` and check again. The operational
skill asks the host to use it whenever an answer states facts about the
project. On Claude Code, a hook that `construct init` installs sends a reply
that states project facts without `check_answer` back once
(`policy.answerCheck`: `nudge` by default, or `off`).

`revise-deliverable` revises an earlier deliverable for a stated change and
keeps the two linked; `revision_linked` asks for the deliverable it revises
and a summary of what changed and why. When the person answers a stale-work
question with revise or re-run, `decide` returns the outcome that would do
it, for the host to offer; nothing starts on its own.

## Settled terms, sensitivity, publishing, and skill impact

`remember` with `contradicts` asks the person to confirm the terms a
decision rules out; once they do, on their own channel, each becomes a
constraint ("Do not state \"exactly-once\" as current"), and
`settled_not_contradicted` sends back answers and drafts that state them
as current without saying they were decided against. A constraint in that
form that an assistant relayed is refused, and one recorded without the
person's own confirmation is never checked. A deliverable records
the highest sensitivity among the sources its run cited;
`publish-deliverable` needs `clearedFor` from the person when that is
confidential or restricted, puts the write itself behind an action-time
approval, and records the location (`published_location`).
`construct skill impact` (and `project_context` topic `quality`) reports,
per skill version, how often its steps passed their checks first time,
mean attempts, waivers, and which checks sent them back. When the
constitution names owners and what each decides, the inbox shows who
decides each question and can be filtered to one owner.
