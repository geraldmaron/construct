# Security policy

## Reporting a vulnerability

Report it privately through this repository's **Security** tab, using
**Report a vulnerability**. Please don't open a public issue, discussion, or
pull request for it.

Include what you found, how to reproduce it, the Construct version
(`construct version`), and the host you ran it under. A fix is disclosed in
the changelog once a release carries it.

## Supported versions

Security fixes are made on the 3.0.0 alpha line and ship as a new alpha under
the `alpha` dist-tag. Nothing in the alpha line is promised stable.

## What is in scope

- The `@geraldmaron/construct` package: the CLI, the MCP server, and the
  skills, workflows, and registry it ships.
- Anything that lets text read from a project, a source, or a model raise
  Construct's authority, approve on the person's behalf, or reach a secret.
- The state store and the project files Construct writes.

Vulnerabilities in an agent host (Claude Code, Cursor, VS Code, OpenCode,
Codex, IBM Bob, Hermes Agent) belong with that host's maintainers.

## How outside text reaches a model

Everything Construct hands a host that came from outside the person (context
search hits, another agent's handoff or result, a recorded source
observation) arrives wrapped as `{origin, trust: "data", content}`. When that
content holds an instruction-shaped passage (an override of earlier
instructions, a claimed role or approval, an exfiltration request, markup
that hides text, or invisible characters), the wrapper adds `flags`, each
naming the family, where it sat, and the passage. Flagging never removes or
rewrites the content; the text stays data either way.
