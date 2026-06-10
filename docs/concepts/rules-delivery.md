# Rules delivery — how `rules/` reaches each host

Construct's `rules/` corpus is load-bearing in two distinct ways, and each rule is honest about
which applies to it (bead construct-bwis; audited in
`docs/research/2026-06-construct-audit/50-proliferation-audit.md`).

## Reference-delivered rules (all hosts)

Rules cited by path in the active surface — personas, the managed AGENTS.md block, skills, other
rules, the CLI (e.g. `rules/common/no-fabrication.md`, `rules/common/commit-approval.md`) — are
delivered by **reference**: the agent reads them with its file tools when the citing prose directs
it to. This works identically on every host and is the only mechanism available on Claude Code,
Codex, and OpenCode, whose harnesses have no per-rule glob-attachment format Construct can emit to.

## Glob-delivered rules (Cursor)

Rules that declare `paths:` frontmatter globs (the language rules — golang/python/swift/
typescript/web) are **delivered** on Cursor, the one supported host with a native per-rule
convention: `.cursor/rules/*.mdc` with comma-separated `globs` frontmatter, auto-attached when a
matching file enters the chat context.

Project-scope `construct sync` (`lib/rules-delivery.mjs`, wired from the Cursor adapter in
`scripts/sync-specialists.mjs`):

- emits one managed `.mdc` per glob-scoped rule **whose globs match files actually present in the
  project** — the project's own contents are the intent signal, so a Go rule lands only in a repo
  containing Go files, never all ~27 glob-scoped rules into every project;
- names emitted files `construct-<dir>-<name>.mdc` and **sweeps** them when their rule stops
  matching, so user-authored `.mdc` files and the `construct.mdc` front-door pointer are never
  touched (the ADR-0027 ownership contract);
- is idempotent — unchanged content is not rewritten.

## The honesty rule

A rule's `paths:` frontmatter means "intended to auto-attach on matching edits", and that intent is
operative **only on Cursor**. On Claude Code, Codex, and OpenCode the same rule is reachable by
reference only. The static audit (`lib/audit-rules.mjs`) classifies every rule as referenced /
glob-scoped / orphan so neither mechanism silently decays; a rule that is neither referenced nor
glob-scoped is a pruning candidate, not a delivery target.
