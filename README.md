# Construct

An outcome engine. Point at an outcome; a learning staff of roles fills in the rest. Work happens in the background; only genuine decisions surface; deliverables arrive finished and traceable.

This is a ground-up rebirth — see [STRATEGY.md](STRATEGY.md) for the full direction, [GLOSSARY.md](GLOSSARY.md) for the vocabulary every surface uses, and [CHANGELOG.md](CHANGELOG.md) for what shipped. The code shares nothing with the predecessor (1.x/2.x), which lives on archived and read-only at `construct-legacy`, but the package is the same one: `@geraldmaron/construct`, continuing past `2.1.1` as `3.0.0-alpha.11`. The `construct` CLI command name is unchanged, as it always was.

Nothing installed today changes under you. Alphas publish under the `alpha` tag, so `latest` stays on the predecessor's `2.1.1` until the Phase 5 stakeholder-acceptance gate passes and `3.0.0` is promoted deliberately — an existing `npm install @geraldmaron/construct` cannot wander into the rewrite.

## Status

**Phases 1 through 3 have landed; Phase 4 is open** (`3.0.0-alpha.11`). The spine runs end to end — outcome → implicated domains → dispatch → deliverable, with an append-only work log, a decision inbox, and a verdict surface. The role packs ship as committed data rather than prompt text, challenges are checked rather than declared, and the model matrix states which families it has actually validated instead of implying all of them. Phase 4 stays open honestly: its depth criterion was withdrawn (next paragraph), and its second-tuned-family criterion was converted to per-skill measurement rather than left blocking (STRATEGY.md, Phase 4, fifth amendment).

**As of 2026-08-20 the program's direction is decided and recorded** (STRATEGY.md Phase 5; `RESEARCH-DECISIONS.md` §22): Construct is a personal tool first, with one product wedge — the method it carries ships as portable, severable skills under `skills/`, one self-contained file per skill, usable in any agent host with no construct checkout present. The first is `skills/investigative-research/`, and its first recorded run is in `docs/skill-runs/`.

**One claim was retired on 2026-08-10, and it was this project's headline one.** Construct used to say that giving a role its own question set made it see what the other roles miss. That was tested — two independently authored fixture organizations, plants keyed to each role's own territory, full sweeps, an independent judge pass — and it is not true: asked different questions over the same material, the roles return the same findings naming the same mechanisms. The external record agrees and got there first (personas measured across 162 variants and four model families do not improve performance; the diversity that does raise independent reasoning is *model* diversity, not persona diversity). So the claim is withdrawn rather than reworded, and the evidence for withdrawing it is published in full: `RESEARCH-DECISIONS.md` §§14–15, with every sweep, score and judged matrix under `fixtures/org-harness*/runs/`.

What that leaves is smaller, and it is the part that was always doing the work: **coverage, obligation, and provenance.** Which concerns a piece of work touches, what each of them owes before anyone relies on the result, and who said what — made explicit, routed without being asked, and auditable afterward. Phase 4's other unmet criterion stands unchanged: only one model family is tuned.

Three limits are load-bearing rather than fine print. **Legal and compliance output is dogfood-only**, and the legal pack declares no covered jurisdiction until a licensed attorney accepts its corpus, so its findings are flagged for licensed review, never issued as advice. **One model family is tuned** (Claude); every other family runs labeled best-effort and writes a degradation note on each dispatch. And **nothing here claims to work for anyone other than its author**: the gates that would have sampled external users are removed, so the project makes no cross-user success-rate claim at all (STRATEGY.md, Phase 5). Treat it as an alpha you can drive, not a product. No stability is promised until the Phase 5 stakeholder-acceptance gate passes, and the `alpha` tag rather than the version number is what enforces that.

**[docs/first-run.md](docs/first-run.md) is the ten-minute walkthrough**, and every command in it has been run as written. The short version:

```bash
npm install -g @geraldmaron/construct@alpha
construct doctor
construct outcome "We want to hire a contractor in Poland"
```

`construct outcome` infers which domains the outcome implicates and queues the work, citing its evidence for each. `construct work --run <id>` runs it, `construct log --run <id>` reads back what was done in whose name, `construct inbox` holds the decisions that are genuinely yours, and `construct verdict --run <id>` is where you say whether it was right to surface what it surfaced. Two flags are worth knowing: `--host=<opencode|claude|codex|cursor>` on `outcome` has that host's model read your words instead of the keyword map, and `--domains=<names>` skips inference when you already know which concerns apply.

Running work needs an agent host present, because Construct never ships its own agent runtime (commitment 1). Four are wired: OpenCode and the Claude Code CLI, plus two that spend a subscription rather than an API key — the Codex CLI (ChatGPT login) and the Cursor CLI (Cursor login). Every adapter is pinned to a probed version (`npm run probe:<host>`), and `construct doctor` now reports each host's presence: found, version against the pin, and auth state. A model family nobody has tuned for still runs on any of them; it is labeled best-effort on the work log, never refused.

If you already work inside an agent host, `construct serve` puts the spine inside it over MCP, so Claude Code, Codex, VS Code agent mode, and OpenCode reach the same store with no CLI to learn:

```bash
claude mcp add construct construct serve
```

That surface is presence, not execution. It can record outcomes, read the log and the inbox, and relay your decisions and verdicts, and it deliberately cannot dispatch work or advance a deliverable toward finished.

If you have a predecessor install and want it removed, `construct cleanup` ships in this alpha (`--dry-run`, `--yes`, `--scope`, `--keep-state`) and refuses to remove the Construct that is running. `npm install @geraldmaron/construct@alpha` reaches it; a plain install stays on 2.x until the gate passes.

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
| Counsel | `contracts`, `privacy`, `employment` | issue-spotting, jurisdiction declared, referral package | **attorney review; dogfood-only** |
| Compliance | `compliance` | controls, evidence, auditability | **attorney review; dogfood-only** |
| Director / VP | `strategy-alignment` | what it displaces, what was promised, who owns the call | — |
| Designer / UX | `user-experience`, `accessibility` | task completion, exclusion by disability | — |
| Data / analyst | `measurement` | whether the claim is observable at all | — |
| Architect / tech lead / platform | `system-design` | boundaries, coupling, what becomes hard to undo | design-review ceiling |
| Security engineer | `security` | who can reach what, and failure behavior | defensive-review ceiling |
| Support / on-call | `operations` | who answers, how you find out, what it costs to keep alive | — |
| Finance / billing | `commerce-tax` | money-flow obligations: what attaches where, who computes, who remits | **tax-professional review** |
| Marketing | `marketing-claims` | claims inventory: substantiation that exists today, or who can pull the claim | — |
| Engineer | — | deliberately absent: your host is the engineer | — |

All fifteen concerns carry a lens — a posture, a question set, extra
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
the size of the gap. And it predates the five concerns added on 2026-08-10
(strategy, system design, operations, user experience, measurement): the labeled
corpora carry no labels for them, so every correct fire on a new concern scores
as a false one. The over-rate above is therefore an upper bound on the real one,
and re-measurement is filed rather than assumed.

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
npm test          # sterile suite via node --test, native TS type-stripping
npm run lint       # no-absolute-paths + glossary parity
npm run typecheck
npm run smoke      # packaged-install smoke: build, pack, install, run
```

Requires Node ≥ 22.18. Source is TypeScript using erasable syntax only, so it runs natively via Node's type-stripping in development — no build step for `npm test`. `npm run build` produces the published `dist/` for packaging.

## License

Apache-2.0
