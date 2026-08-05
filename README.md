# Construct

An outcome engine. Point at an outcome; a learning staff of roles fills in the rest. Work happens in the background; only genuine decisions surface; deliverables arrive finished and traceable.

This is a ground-up rebirth — see [STRATEGY.md](STRATEGY.md) for the full direction, [GLOSSARY.md](GLOSSARY.md) for the vocabulary every surface uses, and [CHANGELOG.md](CHANGELOG.md) for what shipped. The code shares nothing with the predecessor (1.x/2.x), which lives on archived and read-only at `construct-legacy`, but the package is the same one: `@geraldmaron/construct`, continuing past `2.1.1` as `3.0.0-alpha.0`. The `construct` CLI command name is unchanged, as it always was.

Nothing installed today changes under you. Alphas publish under the `alpha` tag, so `latest` stays on the predecessor's `2.1.1` until the Phase 5 second-user gate passes and `3.0.0` is promoted deliberately — an existing `npm install @geraldmaron/construct` cannot wander into the rewrite.

## Status

**Phase 1 is closed** (2026-08-04): the kernel harvest landed and `3.0.0-alpha.0` is published. Phase 2, the spine, is complete but for its exit criterion: the outcome → implication → dispatch → deliverable path runs end to end, with a work log, a decision inbox, and a verdict surface. Treat it as an alpha you can drive, not as a product. No stability is promised until the Phase 5 second-user gate (STRATEGY.md) passes, and the `alpha` tag rather than the version number is what enforces that.

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
