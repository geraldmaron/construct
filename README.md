# Construct

An outcome engine. Point at an outcome; a learning staff of roles fills in the rest. Work happens in the background; only genuine decisions surface; deliverables arrive finished and traceable.

This is a ground-up rebirth — see [STRATEGY.md](STRATEGY.md) for the full direction, [GLOSSARY.md](GLOSSARY.md) for the vocabulary every surface uses, and [CHANGELOG.md](CHANGELOG.md) for what shipped. The code shares nothing with the predecessor (1.x/2.x), which lives on archived and read-only at `construct-legacy`, but the package is the same one: `@geraldmaron/construct`, continuing past `2.1.1` on the `3.0.0` alpha line. The `construct` CLI command name is the same one it always was.

An existing install does not change under you. Alphas publish under the `alpha` tag, so `latest` stays on the predecessor's `2.1.1` until the Phase 5 stakeholder-acceptance gate passes and `3.0.0` is promoted deliberately — an existing `npm install @geraldmaron/construct` cannot wander into the rewrite.

## Status

The spine runs end to end: outcome → implicated domains → dispatch → deliverable, with an append-only work log, a decision inbox, and a verdict surface. The role packs ship as committed data rather than prompt text, challenges are checked rather than declared, and the model matrix states which families have actually been validated instead of implying all of them.

**Phase status lives in exactly one place, [STRATEGY.md](STRATEGY.md)**, which carries the phase plan and states which exit criteria are met, unmet, or withdrawn. This page does not restate it, because a second copy drifts. [CHANGELOG.md](CHANGELOG.md) says what each alpha changed.

**The program's direction is decided and recorded** (STRATEGY.md Phase 5; `RESEARCH-DECISIONS.md` §22): Construct is a personal tool first, with one product wedge. The method it carries ships as portable, severable skills under `skills/`, one self-contained file per skill, usable in any agent host with no construct checkout present. Seven ship: `adversarial-review`, `context-mapping`, `decision-framing`, `intake`, `investigative-research`, `requirements-structuring`, `written-voice`. Each has at least one recorded real-work run under `docs/internal/skill-runs/`.

Shipped and measured are different claims, so the second one has an instrument. `docs/internal/skill-use-ledger.md` is pre-registered: it states what would refute the skills bet before the first use (ten real invocations producing zero gate-changed outcomes refutes the method; not reaching ten invocations within about four weeks of install refutes the triggering and distribution instead, not the method), and one line goes in per real invocation with the receipt for its verdict. Its caveat travels with it rather than sitting in a footnote: the sample is small and it is scored by this program's own sessions against those pre-registered criteria, which is not independent evaluation. The instrument also requires honest no-rows, so the ledger records a no wherever the gate genuinely changed nothing, because a table of nothing but wins is a marketing page rather than a measurement.

The skills ship inside the npm package (`files` is `bin`, `dist`, `skills`), so `npm install` delivers them and `construct skills install <name> --host=<host>` plants one in the directory that host documents reading, with no checkout and no second command to discover. They are equally available without the package: copy the single `SKILL.md` you want from [skills/](skills/), or run `npx skills add geraldmaron/construct` — Vercel's third-party `skills` installer, not this project's own tooling, resolved at whatever version npx finds latest. Bundling was weighed against staying git-only and the argument for each is recorded in `docs/internal/skill-runs/2026-08-20-decision-framing-run-2.md`; the cost accepted in bundling is that a package install carries the skills from the release that shipped it while git carries the live ones, which is why `construct skills installed` reports a planted skill as current or diverged rather than only present.

The two directions are not separate products. A run reads the machine's agent skills directory and this checkout, and tells each dispatched role which of these skills it can reach, what each is for, and where it sits. A machine holding none is told that plainly, so a deliverable cannot read as though a method library was at hand. Which skill fits the work stays the skill's own call: each carries its scope and stand-down rules in its own body, and applying none is a correct outcome. Nothing in that path copies, rewrites, or wraps a skill file, which is what keeps the severability claim above true.

**One claim was retired on 2026-08-10, and it was this project's headline one.** Construct used to say that giving a role its own question set made it see what the other roles miss. That was tested — two independently authored fixture organizations, plants keyed to each role's own territory, full sweeps, an independent judge pass — and it is not true: asked different questions over the same material, the roles return the same findings naming the same mechanisms. The external record agrees and got there first (personas measured across 162 variants and four model families do not improve performance; the diversity that does raise independent reasoning is *model* diversity, not persona diversity). So the claim is withdrawn rather than reworded, and the evidence for withdrawing it is published in full: `RESEARCH-DECISIONS.md` §§14–15, with every sweep, score and judged matrix under `fixtures/org-harness*/runs/`.

What that leaves is smaller, and it is the part that was always doing the work: **coverage, obligation, and provenance.** Which concerns a piece of work touches, what each of them owes before anyone relies on the result, and who said what — made explicit, routed without being asked, and auditable afterward. The model matrix is staggered: one family is tuned, and the second-tuned-family criterion is per-skill measurement rather than a phase gate (STRATEGY.md, Phase 4).

Three limits are load-bearing rather than fine print. **Legal and compliance output is research, never advice**: the legal lens locates and cites the governing text from the primary source, says where it is genuinely unsettled, labels every deliverable as research rather than legal advice, and routes what genuinely requires licensed counsel (representation, filings, sign-off where real liability turns on an unsettled question) to a licensed human with a concrete referral. **One model family is tuned** (Claude); every other family runs labeled best-effort and writes a degradation note on each dispatch. And **nothing here claims to work for anyone other than its author**: the gates that would have sampled external users are removed, so the project makes no cross-user success-rate claim at all (STRATEGY.md, Phase 5). Treat it as an alpha you can drive, not a product. No stability is promised until the Phase 5 stakeholder-acceptance gate passes, and the `alpha` tag rather than the version number is what enforces that.

**[docs/first-run.md](docs/first-run.md) is the ten-minute walkthrough**, and every command in it has been run as written. The short version, if you are already inside Cursor, Claude Code, Codex, OpenCode, or IBM Bob:

Talk there. Staff shows up. "Is this ready?" "Do the claims match?" "What is the product shape?" — ordinary language, no catalog words, no `--host`. This session names the concerns via MCP `record_outcome` (catalog + why), then does the work here via `claim_task` / `submit_work`. Construct keeps the log, the inbox, and verdicts. It will not spawn a second CLI.

```bash
construct serve
```

That is first run. `init`, `doctor`, and the verb catalog are later on this page. They are not beat two.

From a plain terminal with no host wrapping the command, the keyword map is the zero-model fallback:

```bash
construct outcome "We want to hire a contractor in Poland"
```

`construct outcome` infers which domains the outcome implicates and queues the work, citing its evidence for each. `construct work` works the most recently recorded outcome, `construct log --run <id>` reads back what was done in whose name, `construct inbox` holds the decisions that are genuinely yours, `construct lessons` lists and admits held run-derived lessons, and `construct verdict --run <id>` is where you say whether it was right to surface what it surfaced. Two flags are worth knowing: `--host=<opencode|claude|codex|cursor>` on `outcome` has that host's model read your words instead of the keyword map, and `--domains=<names>` skips inference when you already know which concerns apply.

Plant method skills and wire MCP once, when you want the host's skills directory filled:

```bash
npm install -g @geraldmaron/construct@alpha
construct init --yes
```

Those six are the spine, not the whole surface. The surface is 41 verbs, counting `help` itself. `construct help` prints the list, and every verb run with no arguments prints its own usage, which is the one description of a flag that cannot go stale. Grouped:

| What you are doing | Verbs |
|---|---|
| Starting work | `outcome` `ask` `standing` `watch` `schedule` |
| Running it | `work` `notes` |
| Reading back | `status` `show` `log` `plan` `inbox` `corpus` |
| Outward changes and decisions | `propose` `audit` `decide` `waive` `revoke` |
| Ground | `source` `review` |
| Learning and governance | `lessons` `verdict` `staff` |
| Workspace settings | `mode` `consent` `record` `settings` `trust` |
| Composition and reconciliation | `compose` `reconcile` |
| Presence and hosts | `serve` `wire` `init` |
| Maintenance | `doctor` `backup` `cleanup` `daemon` `skills` `completions` `version` `help` |

Two more, `role-serve` and `host-pull-serve`, never appear in the usage line and you never type them: the dispatcher launches `role-serve` as one role's write surface, with the role's token in the environment rather than in arguments, and `host-pull-serve` is an off-by-default execution prototype.

Which of these spend money is worth knowing before you run one. `ask`, `work`, `review`, `compose`, `notes` when it reasons over what you drop in, `outcome --host`, `propose --host` (the plain form as well as `triage`), `standing --due --host` (it runs the full work loop for every firing that has come due), and `decide --apply` all dispatch to a host. Everything else, all of reading back included, is free and local.

Running work needs an agent host present, because Construct never ships its own agent runtime (commitment 1). Four are wired: OpenCode and the Claude Code CLI, plus two that spend a subscription rather than an API key, the Codex CLI (ChatGPT login) and the Cursor CLI (Cursor login). Every adapter is pinned to a probed version (`npm run probe:<host>`), and `construct doctor` reports each host's presence: found, version against the pin, and auth state. A model family nobody has tuned for still runs on any of them; it is labeled best-effort on the work log, never refused.

**Four wired is not four equal, and the difference is declared rather than discovered.** Each adapter states its capabilities, and only `opencode` and `claude` declare `outward-write`, because only those two dispatch with no sandbox flag. Codex dispatches `-s read-only` and Cursor dispatches `--mode plan`, both probed, so a model under either cannot carry out a change however it is asked. That makes `decide --apply` an `opencode`-or-`claude` command, and it says so before a model call is spent rather than after one comes back having failed. The read-only posture is not a gap to work around: it is what makes a review role safe. The same asymmetry runs the other way, and it is stated on screen at apply time: an apply through an unconfined host runs with whatever reach your own install of that host grants it.

If you already work inside an agent host, `construct serve` puts the spine inside it over MCP, so Claude Code, Codex, Cursor, VS Code agent mode, and OpenCode reach the same store with no CLI to learn. Each host registers an MCP server its own way, and the entry is always the same one: `construct serve`. A host with a CLI helper takes it in a line — Claude Code, for example:

```bash
claude mcp add construct construct serve
```

Run from inside a host, `construct wire` detects which host that is and writes the same entry into its MCP config for you; any host that reads a plain config file also takes the entry directly, and `docs/first-run.md`'s "other way in" shows that form.


Chat dogfood without an IDE: nanobot WebUI with Construct attached over MCP
(`docs/internal/host-trial-nanobot.md`, `docs/internal/host-interaction.md`). OpenCode stays the
first-party *execution* host; MCP presence reaches Claude Code, Codex, Cursor,
and peers. Do not stand up a Construct-only chat UI — commitment 1. Xirp is a
future projection target, not a substitute (`RESEARCH-DECISIONS.md` §16).

`construct serve` is how an in-session host does the work. `claim_task` and `submit_work` let the host that is already running execute a queued task on its own capacity and submit a draft. Construct still owns the log, the inbox, and completion: a draft lands, a verdict promotes, and no tool on that surface marks work final. Spawning a second CLI from inside the session you are already in is a second runtime, and `work` will not do it.

If you have a predecessor install and want it removed, `construct cleanup` does it (`--dry-run`, `--yes`, `--scope`, `--keep-state`) and refuses to remove the Construct that is running. `npm install @geraldmaron/construct@alpha` reaches it; a plain install stays on 2.x until the gate passes.

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
catalog carries `evidence-provenance` (where a claim comes from, what kind of
source that is, and whether a reader can check it) and `coverage-gaps` (what is
missing from the record, and whether its absence is a finding or a bias), and
the generated seat map marks each of them, in its own words, `no seat owns
this` — a declared absence, not a row somebody forgot, and the generator now
refuses to build a page at all if a catalog concern reaches it unclassified.
They route from your wording like any other concern and they carry the same
obligations: provenance adds `claim-provenance` and `single-source-claims` to
the deliverable, coverage adds `coverage-frame` and `absences`. The boundary
between them is stated in the catalog itself: provenance asks whether what is
said is traceable, coverage asks whether what is unsaid is a bias. These are
the concerns that fall between the seats, which is exactly why nobody on a
human team is assigned to notice them.

All seventeen concerns carry a lens — a posture, a question set, extra
deliverable slots, and an escalation ladder — and each lens states what its
method stands on: the external standards its questions descend from where a
primary standard exists (OWASP ASVS for security, WCAG 2.2 for accessibility,
FTC substantiation policy for marketing claims), or a stated reason where none
does, because an authoritative-looking citation nobody could defend is worse
than an honest absence.

Seat by seat, with what each concern is obliged to produce, what its deliverable
must answer, and the limit it states about itself: [docs/org-map.md](docs/org-map.md).
That page is generated from the catalog and the gate regenerates and compares
it, so it cannot quietly stop being true.

### What the columns claim, and what they do not

**"Obligations it carries" is a promise about the deliverable, not about
insight.** It means those slots must be filled before the work is called
finished, and that the work log records which concern filled them. It does
**not** mean that concern sees something the others would miss — that claim was
measured, failed, and withdrawn (Status, above). Two concerns routed at one
outcome is worth having because both obligations get answered and any
disagreement between them surfaces, not because each brings private sight.

**Routing is measured, and the number is not flattering.** On wording authored
by people who had never seen the catalog — the only case that matters, since a
user does not know the catalog exists — the shipped router misses **0.280** of
the domains a labeler marked implicated (26/93, Wilson 95% [0.199, 0.378]) and
falsely implicates **0.374** of what it names (40/107, [0.288, 0.468]). Roughly
three in ten concerns that should have been pulled in are not, and better than
a third of what it does name did not belong. The zero-model keyword fallback,
which is what runs with no host present, misses **0.634** (59/93, [0.533,
0.725]) on the same wording. Full figures, both configurations, four corpora:
`RESEARCH-DECISIONS.md` §10, and the run behind these two in §18.

These replace an earlier pair — miss 0.301, over 0.188 — measured before the
instrument was fixed. The miss moved two labels and is noise. The over-rate did
not: 0.188 was computed on a denominator the current script no longer produces,
and every reading available now is worse than the one it published, so it is
replaced rather than reconciled. Both figures above come from one recorded
single-tier run whose per-outcome answers are in `fixtures/namer-arms/`, so
anyone can re-derive them without paying for the run.

Two things that number is not. It is not a completeness claim — nothing here
asserts that every concern an outcome touches is found, and the 0.280 is exactly
the size of the gap. And it predates seven of the seventeen concerns: the five
added on 2026-08-10 (strategy, system design, operations, user experience,
measurement) and the two added on 2026-08-13 (evidence provenance, coverage
gaps). The labeled corpora carry no labels for any of them, so every correct
fire on a later concern scores as a false one. The over-rate above is therefore
an upper bound on the real one, and re-measurement is filed rather than assumed.

**Nothing here claims anything about anyone but its author.** No external
subjects are sampled anywhere in this program, by standing decision, so no
cross-user success rate is claimed at any confidence (STRATEGY.md, Phase 5).

### The record of a retired claim

Until 2026-08-10 this table had a column reporting per-concern depth. It is gone,
and the harnesses that killed it are still in the repository on purpose.

The instrument: every lens dispatched once, clean context, over a fixture
organization, scored against an answer key committed before any run and never
edited to make a run pass. First finding — with "at depth" defined as the owning
lens hitting its own plant, six concerns passed, but ten of thirteen plants were
also produced by lenses that did not own them, so the test could not tell a lens
that contributed something from a run that swept the corpus. Depth was then
redefined as **isolation** (the owner produces it and nobody else), and the
repairs were tried in order: bounding how much each role reports (output down
44%, off-lens findings down 47%, no verdict changed), then rewriting all ten
plants from scratch, one per role, each keyed to territory only its owner asks
about (off-lens findings 18 → 19). A judge pass confirmed 41 of 50 credited
claims genuinely state the planted mechanism, so the collisions were real and not
a scoring artifact.

That left one explanation — the corpus was 22 documents from a single project,
narrow enough that convergence might belong to the material. So a second fixture
organization was built from 22 documents of a real organization's operating
documentation (agreements, pricing, hiring, account ownership, delivery
failures), held to parity on document count and bytes, with ten plants on twenty
**disjoint** documents and every plant verified creditable before any run
existed. Both corpora were swept in one sitting on one family. **Zero of ten
plants isolate on the broad corpus, one of ten on the original.**

Breadth was the last instrument-side explanation, and it failed. What remained
was the premise, and the premise was settled from the published record rather
than by a fifth study of our own. The reasoning, the confounds (the broad corpus
was the *harder* of the two, which is why the finding is "breadth did not rescue
discrimination" and not "breadth made it worse"), and the sources are in
`RESEARCH-DECISIONS.md` §§14–15.

It is published rather than repaired quietly because a coverage number dressed as
a depth number is the exact failure this project exists to prevent — including,
and especially, when the project is the one making it.


## Development

```bash
npm install
npm run lint && npm run typecheck && npm test && npm run smoke
```

That line is the whole gate; nothing is done without it. `npm run lint` is a chain of small checks rather than a linter: no absolute paths, glossary parity, no tracker ids in code, skill-spec conformance, reader-rubric parity, the connector gate, terminal-escape safety, a check that every command printed in the documentation names a verb and subcommand the CLI actually accepts (asked of the CLI, not of a table beside it), and a regeneration of `docs/org-map.md` compared against the committed copy, so a catalog edit that would quietly falsify that page fails here instead. `npm test` is the sterile suite through `node --test`. `npm run smoke` packs the package, installs it into a scratch project, and runs the spine as a consumer would.

Requires Node ≥ 22.18. Source is TypeScript using erasable syntax only, so it runs natively via Node's type-stripping in development, with no build step for `npm test`. `npm run build` produces the published `dist/` for packaging.

## License

Apache-2.0
