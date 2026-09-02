# Construct

Construct is a project-bound, capability-aware operating layer for agent
hosts. Installed into a project, it learns what the project is, remembers
authoritative context and constraints, resolves the skills and workflows an
outcome needs, detects material drift, does permitted work through the agent
host you already use, and surfaces only the decisions that are yours.

This is the `3.0.0` alpha line of `@geraldmaron/construct`, under
architectural cutover. Alphas publish under the `alpha` tag; `latest` stays on
the predecessor. Nothing here is promised stable.

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
and `--constraint` to init. The operational `construct` skill is planted into
the host you are in (`--client=<host>` or `--skills-dir=<dir>` chooses).

After that, talk in your agent session. The command line is for setup,
inspection, scripting, and recovery: `construct status`, `construct doctor`,
`construct config explain <key>`, `construct source add`, `construct reset`.
`construct help` lists everything.

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
