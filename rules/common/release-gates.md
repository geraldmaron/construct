<!--
rules/common/release-gates.md — Hard release gates for Construct work.

Defines the blocking contracts every agent and persona must satisfy locally
before any commit, push, or "done" claim. Loaded by the construct persona,
AGENTS.md, and the engineer/reviewer/operator role overlays. Enforcement is at
the prompt level — CI is a backstop, not the primary gate.
-->
# Release Gates — Hard Contracts

These are blocking gates. Every agent, persona, and harness session working in or shipping Construct must satisfy them locally **before** any commit, push, or "done" claim. CI is a backstop, not the primary check.

The goal is simple: if a gate would fail in CI, it fails locally first. We never push and pray.

## The five local gates

Run these before declaring work done. Pasting the output into the PR body or `bd note` is the standard evidence.

| Gate | Command | Pass criterion |
|---|---|---|
| Tests | `npm test` | 0 failed, 0 unexpected skips |
| Comment policy | `node bin/construct lint:comments` | 0 errors AND 0 warnings |
| Doc verification | `node bin/construct docs:verify` | "All documentation checks passed" — no warnings either |
| AUTO doc drift | `node bin/construct docs:update --check` | "Docs are up to date" |
| Template policy | `npm run lint:templates` | "Template policy: clean." |

The shortcut for all five (plus dashboard sync) is:

```bash
npm run release:check
```

## Commit + PR templates

The repo enforces `.gitmessage` and `.github/pull_request_template.md`. Both are validated by `scripts/lint-commits-pr.mjs` (the `lint-templates` CI job) and fail the build on any deviation.

Commit subjects must match `type(scope): subject` — type from {feat, fix, refactor, perf, docs, test, chore, ci, build, style}, imperative mood, ≤72 chars, no trailing period, lowercase after the colon. Run `git config commit.template .gitmessage` once per clone to load the template into your editor.

PR descriptions must keep all six headings — Summary, Beads issue, Doc updates included, Local gates, Test plan, Risks / rollback — with at least one checked box in both the "Doc updates" and "Local gates" sections. Empty templates fail.

Forbidden in commit messages: `Co-Authored-By: Claude*` trailers (unless the user explicitly asks), `--no-verify`, `--no-gpg-sign`. Forbidden in PR bodies: deleting the required headings, leaving every gate box unchecked.

## The tracker contract

For every non-trivial change:

1. **A Beads issue exists.** `bd ready` to find or create one. `bd show <id>` to read context. `bd update <id> --claim` to claim before editing files.
2. **`plan.md` reflects the work.** Even though `plan.md` is local-only and gitignored, it stays the human-readable working plan. Mark items `done` when they ship; add new rows for work that wasn't previously tracked.
3. **Doc updates land in the same change as code.** If runtime shape, contracts, boundaries, or major dependencies changed, update `docs/concepts/architecture.md` in the same commit. If the docs surface or maintenance contract changed, update `docs/README.md`. If active work, decisions, or assumptions changed, update `.cx/context.md` and `.cx/context.json`. Always add a `CHANGELOG.md` entry.
4. **Beads close on green.** `bd close <id>` happens after CI is green and the work is verified — not before.

## Hard rules

- **Do not commit if any gate fails.** Fix the underlying issue. Do not skip hooks (`--no-verify`), do not bypass with `[skip ci]` for code changes.
- **Do not push expecting CI to catch it.** If you would not run a gate locally, do not run it in CI.
- **Do not declare DONE before the gates run.** "Tests pass" without `npm test` evidence is not done.
- **Comment policy violations are blocking, not advisory.** Warnings count as failures for this gate.
- **Documentation drift is a code change.** A code commit that should have triggered a doc update but did not is incomplete work, not a follow-up.

## When a gate must be bypassed

If a gate is genuinely broken (tooling regression, infra issue) and the change is unrelated:

1. State the gate name and the failure.
2. Confirm with the user before bypassing.
3. File a Beads issue for the broken gate.
4. Note the bypass in the PR body and the Beads issue.

This is the only authorized form of bypass. "I'll fix it later" is not.
