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

Vulnerabilities in an agent host (Claude Code, Codex, Cursor, OpenCode) belong
with that host's maintainers.
