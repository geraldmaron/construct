# Construct

Construct is a project-bound, capability-aware operating layer for agent
hosts. Installed into a project, it learns what the project is, remembers
authoritative context and constraints, resolves the skills and workflows an
outcome needs, detects material drift, does permitted work through the agent
host you already use, and surfaces only the decisions that are yours.

This is the `3.0.0` alpha line of `@geraldmaron/construct`, under
architectural cutover. Alphas publish under the `alpha` tag; `latest` stays on
the predecessor. Nothing here is promised stable.

## Alpha.26

- One native work ledger across project worktrees, with fenced claims, path
  reservations, handoffs, and peer awareness.
- Person-only approval and acceptance boundaries, explicit state upgrades,
  and recovery that preserves existing work.
- Opt-in bounded delegation through Claude, Codex, and Cursor adapter paths:
  isolated patch proposals, independent review, cancellation, and serial
  integration with combined-result validation.

**Delegation remains disabled by default and is not live-verified across the
three tools.** Synthetic tests exercise all six directions; real subscription,
permission, and interoperability evidence is still required before enabling
an executor. This alpha does not claim production-ready three-tool delegation.

Read the [changelog](CHANGELOG.md), [delegation guide](docs/bounded-delegation.md),
and [verification record](docs/internal/multi-agent-coordination/DELEGATION-VERIFICATION.md)
for the shipped behavior and remaining release gates.

## First run

```bash
npm install -g @geraldmaron/construct@alpha
construct init
```

Init writes `.construct/` (project, constitution, sources, and registry lock
files, committed) and one runtime database under `.construct/state/`
(ignored). It reads the project's own files and proposes what it can, each
proposal naming where it came from, then asks three questions: what this
project is to you, what result matters most now, and what must not be
violated. Answer them in your agent session, or pass `--scale`, `--outcome`,
and `--constraint` to init. Proposed statements wait in `construct inbox`
until you confirm or retire them. The operational `construct` skill is planted into
the host you are in (`--client=<host>` or `--skills-dir=<dir>` chooses).

After that, talk in your agent session. The command line is for setup,
inspection, scripting, and recovery: `construct status`, `construct doctor`,
`construct config explain <key>`, `construct source add`, `construct reset`,
and `construct migrate` when an upgrade of Construct needs the state upgraded
too (stop every Construct session on the project first).
`construct help` lists everything.

When upgrading an existing project, stop its Construct sessions before running
`construct migrate`. Alpha.26 uses state format 4; older state must be upgraded
explicitly. Migration takes a backup under its upgrade lock. Run
`construct doctor` afterward and follow any skill-update instructions before
reopening agent sessions. Installing this package does not authorize workers.

Limits that are load-bearing: legal, compliance, and other licensed
judgments are research and preparation, never advice or sign-off. This alpha
is its author's dogfood; nothing here claims to work for anyone else.

## Development

```bash
npm install
npm run lint && npm run typecheck && npm test && npm run smoke
```

That line is the whole gate. `npm run lint` is a chain of small checks: no
absolute paths, glossary parity, no tracker ids in code, skill-spec
conformance, terminal-escape safety, a documentation index, and a check that
every command printed in the documentation is one the CLI accepts. `npm test`
is the sterile suite through `node --test`. `npm run smoke` packs the
package, installs it into a scratch project, and runs the spine from packaged
bytes.

Requires Node ≥ 22.18. Source is TypeScript using erasable syntax only, run
natively by Node's type stripping; `npm run build` produces `dist/` for
packaging.

## License

Apache-2.0
