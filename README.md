# Construct

An outcome engine. Point at an outcome; a learning staff of roles fills in
the rest. Work happens in the background; only genuine decisions surface;
deliverables arrive finished and traceable.

That is **outcome in, decisions out**. You state what you want to be true.
Construct does not ask you to operate a verb catalog, name roles, or pick a
host flag to get started.

This is a ground-up rebirth on the same package name,
`@geraldmaron/construct`, continuing past `2.1.1` on the `3.0.0` alpha line.
Alphas publish under the `alpha` tag, so `latest` stays on the predecessor's
`2.1.1` until the Phase 5 stakeholder-acceptance gate passes. An existing
`npm install @geraldmaron/construct` cannot wander into the rewrite. Direction,
vocabulary, and what each alpha changed live in [STRATEGY.md](STRATEGY.md),
[GLOSSARY.md](GLOSSARY.md), and [CHANGELOG.md](CHANGELOG.md). Measurements
and retired claims live in [RESEARCH-DECISIONS.md](RESEARCH-DECISIONS.md);
this page is not that paper.

## First run

[docs/first-run.md](docs/first-run.md) is first run: talk in the host you
already have; staff shows up. The terminal command list is
[docs/cli-walkthrough.md](docs/cli-walkthrough.md). The short version, if you
are already inside Cursor, Claude Code, Codex, OpenCode, or IBM Bob:

Talk there. Staff shows up. Ordinary language, no catalog words, no `--host`.
The host infers. Two surfaces only: dispatch through this session
(`record_outcome`, then `claim_task` / `submit_work`), or an inbox call when
the decision is yours. Construct does not classify, name, or route. No phrase
table. Then the work happens here. Construct will not spawn a second CLI.

```bash
construct serve
```

That is first run. `init`, `doctor`, and the verb catalog live in
`construct help` and [docs/cli-walkthrough.md](docs/cli-walkthrough.md).
They are not beat two.

From a plain terminal with no host wrapping the command, the keyword map is
the zero-model fallback:

```bash
construct outcome "We want to hire a contractor in Poland"
```

Install the alpha when you want the CLI and the method skills on the machine:

```bash
npm install -g @geraldmaron/construct@alpha
```

Four execution adapters ship: OpenCode, Claude Code, the Codex CLI, and the
Cursor CLI. Only OpenCode and Claude Code declare `outward-write`. Codex
dispatches read-only and Cursor dispatches in plan mode, both probed, so
`decide --apply` is an OpenCode-or-Claude command. IBM Bob is a talk-in-host
target (ambient detection exists; skills can plant there) and is not an
execution adapter. `construct wire` writes the MCP entry for Claude Code and
Cursor only; every other host takes the same `construct serve` entry by hand.
The walkthrough shows that form.

Three limits are load-bearing rather than fine print. **Legal and compliance
output is research, never advice.** **One model family is tuned** (Claude);
every other family runs labeled best-effort. **Nothing here claims to work
for anyone other than its author** — treat it as an alpha you can drive, not
a product. No stability is promised until the Phase 5 stakeholder-acceptance
gate passes.

Seven portable method skills ship inside the npm package (`bin`, `dist`,
`skills`): `adversarial-review`, `context-mapping`, `decision-framing`,
`intake`, `investigative-research`, `requirements-structuring`,
`written-voice`. `construct skills install <name> --host=<host>` plants one
in the directory that host documents reading.

## Which seat it fills

Construct routes by concern, never by job title. You describe an outcome in
your own words; the concerns it touches are inferred from those words. So the
question "does it cover my role?" is really "is the thing my role notices in
the catalog, and will it fire without me knowing to ask?"

Here is that map. It is also the honest coverage report — nobody types any name
in the right-hand columns.

| The seat on a human team | The concern it owns here | Obligations it carries | Before anyone relies on it |
|---|---|---|---|
| Product manager | `product-scoping` | scope in/out, success signal | — |
| Program manager / TPM | `program-sequencing` | order, dependencies, date realism | — |
| Counsel | `contracts`, `privacy`, `employment` | issue-spotting, governing text cited from the primary source, referral package | labeled research, not legal advice |
| Compliance | `compliance` | controls, evidence, auditability | labeled analysis, not an audit opinion |
| Director / VP | `strategy-alignment` | what it displaces, what was promised, who owns the call | — |
| Designer / UX | `user-experience`, `accessibility` | task completion, exclusion by disability | — |
| Data / analyst | `measurement` | whether the claim is observable at all | — |
| Architect / tech lead / platform | `system-design` | boundaries, coupling, what becomes hard to undo | design-review ceiling |
| Security engineer | `security` | who can reach what, and failure behavior | defensive-review ceiling |
| Support / on-call | `operations` | who answers, how you find out, what it costs to keep alive | — |
| Finance / billing | `commerce-tax` | money-flow obligations: what attaches where, who computes, who remits | **tax-professional review** |
| Marketing | `marketing-claims` | claims inventory: substantiation that already exists, or who can pull the claim | — |
| Engineer | — | deliberately absent: your host is the engineer | — |

**Two concerns are not in that table, because no job title claims them.** The
catalog carries `evidence-provenance` and `coverage-gaps`. They route from
your wording like any other concern. The generated seat map marks each of
them `no seat owns this` — a declared absence, not a forgotten row.

All seventeen concerns carry a lens. Seat by seat, with what each concern is
obliged to produce: [docs/org-map.md](docs/org-map.md). That page is generated
from the catalog and the gate regenerates and compares it.

**"Obligations it carries" is a promise about the deliverable, not about
insight.** Those slots must be filled, and the work log records which concern
filled them. It does not mean that concern sees something the others would
miss. That depth claim was measured, failed, and withdrawn — the record is
`RESEARCH-DECISIONS.md` §§14–15, not this page.

Routing is measured too. The numbers are not flattering, and they belong
with the instrument that produced them: `RESEARCH-DECISIONS.md` §10 and §18.
Nothing here claims anything about anyone but its author (STRATEGY.md,
Phase 5).

## Development

```bash
npm install
npm run lint && npm run typecheck && npm test && npm run smoke
```

That line is the whole gate; nothing is done without it. `npm run lint` is a
chain of small checks rather than a linter: no absolute paths, glossary
parity, no tracker ids in code, skill-spec conformance, reader-rubric
parity, the connector gate, terminal-escape safety, a check that every
command printed in the documentation names a verb, subcommand, and flag the
CLI actually accepts (asked of the CLI, not of a table beside it), and a
regeneration of `docs/org-map.md` compared against the committed copy.
`npm test` is the sterile suite through `node --test`. `npm run smoke` packs
the package, installs it into a scratch project, and runs the spine as a
consumer would.

Ordinary GitHub Actions on push and pull request run `lint`, `typecheck`,
and the first-run staffing/surface subset (`npm run test:first-run`). The
full gate — that line, plus the suite under a read-only `HOME` — is the `ci`
workflow's `workflow_dispatch` and the release-tag workflow before publish.
Tracker-only commits under `.beads/` do not start a run.

Requires Node ≥ 22.18. Source is TypeScript using erasable syntax only, so it
runs natively via Node's type-stripping in development, with no build step
for `npm test`. `npm run build` produces the published `dist/` for packaging.

## License

Apache-2.0
