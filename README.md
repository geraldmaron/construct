# Construct

Construct is a project-bound operating layer for the agent host you already use.
It stores admitted context and work, resolves versioned methods and workflows,
and keeps delivery, verification, review and your acceptance separate. Your host
provides the model, tools and sandbox.

**Experimental: 3.0.0-alpha.28.** Available under npm’s `alpha` tag; `latest`
remains on the 2.x line. Installation and static host wiring are tested;
broad host effectiveness, canonical native isolation and measured skill benefit
remain unqualified. See [verification and limits](#verification-and-limits).

## Install and start

Requires **Node.js 22.18 or newer**. In your project:

```bash
npm install -g @geraldmaron/construct@alpha
construct init --client=cursor
construct doctor
```

Replace `cursor` with `claude-code`, `vscode`, `opencode`, `codex` or `bob`.
You can comma-separate hosts. Follow the one-time connection steps printed by
`init`, then start a new host session in the project.

`init` writes committed configuration under `.construct/`, an ignored runtime
store under `.construct/state/`, project MCP wiring and the operating skill for
your selected hosts. It proposes context from local project files; proposals
retain provenance and wait for confirmation. Setup questions should be asked
only when their answers affect your request. [First-run guide](docs/first-run-and-hosts.md).

## Use it in your host

Ask in your own words, for example:

- “Remember that public API changes need a migration plan.”
- “Use our architecture and prior decisions to compare these options.”
- “Review this change and show what was actually verified.”
- “What work remains, and where should we resume?”

The operating skill directs the host to retrieve relevant context, interpret
managed requests, choose a path, claim work and submit evidence. A plain question
creates no managed run; memory is recorded only when requested. Source text and
other agents’ output are data, never permission.

The CLI is for setup, inspection, scripting and recovery:

```bash
construct status
construct work ready
construct help
```

See the [CLI reference](docs/cli-reference.md) and
[host-tool reference](docs/broker-reference.md) for exact commands and inputs.

## What it provides

- **Project context:** a local SQLite FTS5 index over admitted source passages,
  decisions, work and prior outcomes. Exact lookup, bounded host query expansion
  and explicit relationships supplement text ranking. Optional supplied vectors
  require an explicitly configured model, dimensions and matching content digests.
  Construct downloads no embedding model and invokes no paid embedding fallback.
- **Portable execution paths:** research, decisions, artifacts, implementation and
  review reuse the same resolver and ledger. General chat delivery needs no code
  tests or file writer. Code work uses the project’s validation path.
- **Evidence and continuity:** immutable source-generation citations, provenance,
  freshness, coverage gaps, fenced work claims and durable partial checkpoints.
  Similarity establishes relevance, not authority or factual support.
- **Explicit assurance:** structural validation, observed commands, semantic review
  and person acceptance are separate. Paths requiring independent review retain
  drafts until a supported adapter observes that review. Self-review stays labeled.
- **Host wiring:** shared protocol and project configuration for Claude Code,
  Cursor, VS Code, OpenCode, Codex and IBM Bob. Static conformance covers all six;
  it does not establish native execution parity.

[Sources and retrieval](docs/sources-and-authority.md) ·
[Workflows](docs/workflows-and-resolution.md) ·
[Skills](docs/skills-and-packs.md) · [Work ledger](docs/work-ledger.md).

## Verification and limits

The alpha.28 release passed lint, typecheck, the full test suite, packaged isolated
smoke and static six-host conformance. Three finite native held-text controls
accepted correct arithmetic and rejected incorrect arithmetic and an injected
source. One ordinary native decision trial completed after a method citation
repair; it took 218 seconds and 13 Construct calls. These observations do not
establish general effectiveness, injection resistance or causal skill benefit.

Delegation is disabled until explicitly configured and live-verified. A saved
standing outcome does not install a clock or executor. External sources depend
on available authorized host tools or configured readers; declaring a source
is not proof that it can be read. Licensed judgments remain preparation for a
qualified person, never professional sign-off.

[Release notes](CHANGELOG.md) · [Release policy](docs/release-verification.md) ·
[Measured alpha.28 observations](docs/internal/alpha-audit-2026-10-13/portable/FOLLOWUP.md) ·
[Delegation](docs/bounded-delegation.md) · [Recurring operation](docs/recurring-operation.md).

## Upgrade

Install the new package, stop the project’s Construct sessions, then follow
`construct doctor`. Current state format is **5**; run `construct migrate` only
when an older supported store needs upgrading. Migration backs up the store;
do not reset it to upgrade. Run `construct init --client=<host>` to reconcile
wiring and `construct skill update` to reconcile the registry, then restart
sessions. Existing runs keep their frozen bindings; re-resolve an outcome to
use new workflow or method versions while preserving its prior work.

[Upgrade and recovery guide](docs/troubleshooting-and-recovery.md).

## Documentation

The [GitHub documentation index](docs/README.md) is the docsite. It links the
user guides and generated CLI, tool, configuration, catalog and state references.
[Dated internal records](docs/internal/README.md) are history, not current usage
instructions. Report documentation or behavior issues in
[GitHub Issues](https://github.com/geraldmaron/construct/issues).

## Development

```bash
npm ci
npm run lint && npm run typecheck && npm test && npm run smoke
npm run conformance
```

Source is TypeScript with erasable syntax, run by Node’s native type stripping.
`npm run build` compiles `dist/` for packaging. Generated references come from
code definitions: use `npm run registry:index` and `npm run docs:generate`, not
hand edits. See [architecture](docs/architecture-and-state-model.md) and
[authoring and qualification](docs/authoring-and-qualification.md).

## License

[Apache-2.0](LICENSE).
