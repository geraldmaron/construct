# Construct

An outcome engine. Point at an outcome; a learning staff of roles fills in the rest. Work happens in the background; only genuine decisions surface; deliverables arrive finished and traceable.

This is a ground-up rebirth — see [STRATEGY.md](STRATEGY.md) for the full direction, [GLOSSARY.md](GLOSSARY.md) for the vocabulary every surface uses, and [CHANGELOG.md](CHANGELOG.md) for what shipped. The code shares nothing with the predecessor (1.x/2.x), which lives on archived and read-only at `construct-legacy`, but the package is the same one: `@geraldmaron/construct`, continuing past `2.1.1` as `3.0.0-alpha.3`. The `construct` CLI command name is unchanged, as it always was.

Nothing installed today changes under you. Alphas publish under the `alpha` tag, so `latest` stays on the predecessor's `2.1.1` until the Phase 5 stakeholder-acceptance gate passes and `3.0.0` is promoted deliberately — an existing `npm install @geraldmaron/construct` cannot wander into the rewrite.

## Status

**Phases 1 through 4 have landed** (`3.0.0-alpha.3`). The spine runs end to end — outcome → implicated domains → dispatch → deliverable, with an append-only work log, a decision inbox, and a verdict surface. The role packs ship as committed data rather than prompt text, challenges are checked rather than declared, and the model matrix states which families it has actually validated instead of implying all of them.

Phase 4 has criteria it has **not** met, said here rather than left to the changelog: only one model family is tuned, the program pack's depth was reopened when the prompt behind its two passing runs changed, and — found on 2026-08-10 and the largest of the three — the pack-depth measurement itself does not do what its name claims. A full eleven-lens sweep on the tuned family showed that most planted findings are produced by lenses that do not own them, so the old "at depth" verdict was measuring how much of the corpus a run swept rather than what the lens contributed. Every affected claim is restated in the table below; exactly one concern survives the stricter rule.

Three limits are load-bearing rather than fine print. **Legal and compliance output is dogfood-only**, and the legal pack declares no covered jurisdiction until a licensed attorney accepts its corpus, so its findings are flagged for licensed review, never issued as advice. **One model family is tuned** (Claude); every other family runs labeled best-effort and writes a degradation note on each dispatch. And **nothing here claims to work for anyone other than its author**: the gates that would have sampled external users are removed, so the project makes no cross-user success-rate claim at all (STRATEGY.md, Phase 5). Treat it as an alpha you can drive, not a product. No stability is promised until the Phase 5 stakeholder-acceptance gate passes, and the `alpha` tag rather than the version number is what enforces that.

**[docs/first-run.md](docs/first-run.md) is the ten-minute walkthrough**, and every command in it has been run as written. The short version:

```bash
npm install -g @geraldmaron/construct@alpha
construct doctor
construct outcome "We want to hire a contractor in Poland"
```

`construct outcome` infers which domains the outcome implicates and queues the work, citing its evidence for each. `construct work --run <id>` runs it, `construct log --run <id>` reads back what was done in whose name, `construct inbox` holds the decisions that are genuinely yours, and `construct verdict --run <id>` is where you say whether it was right to surface what it surfaced. Two flags are worth knowing: `--host=<opencode|claude>` on `outcome` has that host's model read your words instead of the keyword map, and `--domains=<names>` skips inference when you already know which concerns apply.

Running work needs an agent host present, either OpenCode (first-class) or the Claude Agent SDK, because Construct never ships its own agent runtime (commitment 1). `construct doctor` checks the parts it owns; it does not yet check that a host is reachable.

If you already work inside an agent host, `construct serve` puts the spine inside it over MCP, so Claude Code, Codex, VS Code agent mode, and OpenCode reach the same store with no CLI to learn:

```bash
claude mcp add construct construct serve
```

That surface is presence, not execution. It can record outcomes, read the log and the inbox, and relay your decisions and verdicts, and it deliberately cannot dispatch work or advance a deliverable toward finished.

If you have a predecessor install and want it removed, `construct cleanup` ships in this alpha (`--dry-run`, `--yes`, `--scope`, `--keep-state`) and refuses to remove the Construct that is running. `npm install @geraldmaron/construct@alpha` reaches it; a plain install stays on 2.x until the gate passes.

## Which seat it fills

Construct routes by concern, never by job title: you describe an outcome, and
the concerns it touches are inferred from your own words. So the question "does
it cover my role?" is really "is the thing my role notices in the catalog?"
Here is that map, and it is also the honest coverage report — nobody types any
name in the right-hand column.

| The seat on a human team | The concern it owns here | What the full sweep measured |
|---|---|---|
| Compliance | `compliance` | **isolated** — the only one; dogfood-only |
| Product manager | `product-scoping` | found, not isolated |
| Program manager / TPM | `program-sequencing` | found, not isolated |
| Counsel | `contracts`, `privacy`, `employment` | found, not isolated; dogfood-only |
| Director / VP | `strategy-alignment` | found, not isolated; its plant restates the product one |
| Designer / UX | `user-experience`, `accessibility` | found, not isolated |
| Data / analyst | `measurement` | found, not isolated |
| Security engineer | `security` | found, not isolated |
| Architect / tech lead / platform | `system-design` | missed by its own lens |
| Support / on-call | `operations` | missed by its own lens |
| Finance / billing | `commerce-tax` | routes, default template, unmeasured |
| Marketing | `marketing-claims` | routes, default template, unmeasured |
| Engineer | — | deliberately absent: your host is the engineer |

Read that column carefully, because it was weaker than this page used to say.
The measurement is a sweep: every lens dispatched once, clean context, over a
fixture organization, scored against an answer key committed before any run and
never edited to make a run pass. A concern is **isolated** only when the lens
that owns a planted finding produces it *and no other lens does*. **Found, not
isolated** means the finding was produced, but lenses that do not own it
produced it too — so the run shows the corpus was swept, not that the lens
contributed anything the others would have missed. **Missed** means the owning
lens did not produce its own finding at all.

Until 2026-08-10 this table said "at depth" for six rows, on a rule that only
asked whether the owning lens hit its plant. A full eleven-lens sweep on the
tuned family then showed ten of the thirteen planted findings being produced by
lenses that do not own them, so that rule could not tell depth from coverage,
and the rows resting on it have been restated above. One concern survives the
stricter rule. This is published rather than repaired quietly because a
coverage number dressed as a depth number is the exact failure this project
exists to prevent — including when the project is the one making it. The
sweep, its per-run scores, and the discrimination matrix are all under
`fixtures/org-harness/runs/`; `npm run harness:discrimination -- --suite claude`
reproduces the verdict from them.

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
