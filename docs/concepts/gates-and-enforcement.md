---
title: Gates and enforcement
description: Three layers of policy enforcement — real-time, commit/push, CI safety net. Every blocking gate has an explicit bypass.
---

Construct treats policy enforcement as defense in depth. Every meaningful rule lives in three places: a real-time gate that catches violations at the source, a commit/push gate that blocks them before they leave your machine, and a CI gate that catches anything that escaped the first two. The architecture is deliberately redundant — the failure mode you want to avoid is "the rule existed but never fired."

Every blocking gate ships with an explicit env-var bypass. Bypasses are auditable because they're explicit in command history; silent bypasses are not allowed.

## Layer 1 — Real time

Fires during write, while the agent is composing code or running commands.

- **`comment-lint` (PostToolUse)** — blocks Write/Edit/MultiEdit if the edit introduces a banned comment pattern (narrative voice, point-in-time notes, noise sentinels) or a missing required header. Bypass: `CONSTRUCT_SKIP_COMMENT_LINT=1`.
- **`doc-coupling-check` (PostToolUse, advisory)** — counts code-file edits per session and emits stderr advisories at thresholds (3, 5, 10) when no doc files have been touched. Doesn't block; just nudges. The commit-time gate is the real enforcement.
- **`ci-status-check` (UserPromptSubmit)** — injects the most recent CI run status for the current branch into the agent's context every prompt. Cached 60s. The agent literally cannot claim "I didn't know CI was red."

## Layer 2 — Commit and push

Fires when you try to land changes.

**Commit-time (`.beads/hooks/pre-commit`):**

- ECC secret scan — blocks high-signal secret patterns in staged content.
- `construct lint:comments` — same banned-pattern check as Layer 1, runs on the full diff to match CI behaviour.
- `construct docs:verify` — blocks a commit that changes `lib/`, `bin/`, `src/`, or `app/` without a matching `CHANGELOG.md` / `docs/` / `.cx/context.*` update.

Bypasses: `CONSTRUCT_SKIP_GATES=1` (whole layer), `CONSTRUCT_SKIP_DOCS=1` (docs-coupling only), `ECC_SKIP_PRECOMMIT=1` (secret scan only).

**Push-time (`lib/hooks/pre-push-gate.mjs`):**

- Refuses `claude/*` branch pushes. Bypass: `CONSTRUCT_ALLOW_CLAUDE_PUSH=1`.
- Refuses push if the last remote CI run on the current branch failed.
- Runs `npm test`, `npm run build`, `construct evals retrieval`, `construct docs:verify`, `npm audit --omit=dev --audit-level=high` locally before allowing the push.

Bypass: `CONSTRUCT_SKIP_PREPUSH=1`.

**`gh pr create` / `gh pr edit` (Layer 2.5):**

- The pre-push hook also intercepts these commands and runs `construct lint:templates` on the body to catch PR-template policy violations before the PR even opens.

Bypass: `CONSTRUCT_SKIP_PR_LINT=1`.

## Layer 3 — CI + session end

Catches escapees from Layers 1 and 2.

**Required status checks on `main`** (configured via GitHub branch protection):

`test (matrix × 4)`, `retrieval evals`, `dependency CVE audit`, `secret scanning`, `postgres + pgvector integration`, `docs drift check`, `comment policy`, `template policy`, `gates audit`. None of these can be bypassed without admin intervention.

**Session-end checks (`policy-engine.mjs` Stop handler):**

- **Red-CI block** — refuses to end the session if CI is red on the current branch and the agent edited code this session. Bypass: `CONSTRUCT_STOP_OK_RED_CI=1`.
- **Open-beads block** — refuses to end the session if beads issues are in `in_progress` status. Bypass: `CONSTRUCT_STOP_OK_OPEN_BD=1`.
- **Drive-mode criteria** — refuses to end a `drive` autonomous session if acceptance criteria are unmet.

**Self-validation:** `construct gates:audit` walks all four enforcement surfaces (CI workflows, pre-push, pre-commit, branch protection) and reports gaps. Runs in CI on every PR; failures block merge.

## Local-only by design

Two gates are intentionally local-only and have no CI counterpart. This is a deliberate choice, not an oversight — future maintainers should not "fix" the asymmetry by mirroring them in CI.

- **`claude/*` branch push refusal** (pre-push). Stylistic: agent-prefixed branch names should not appear in remote history. Enforcing in CI would block legitimate one-off pushes by a contributor who knew what they were doing; enforcing locally catches the accidental case and stays out of the way for the intentional one.
- **Red-CI-before-push** (pre-push). Catches the "push on top of a known-red CI" footgun where the contributor hadn't yet seen the failure. The actual red-CI is already enforced by required status checks on `main` — pushing red commits to a feature branch is allowed and sometimes necessary (e.g., to trigger a CI debug). The local hook is a courtesy.

Everything else in Layer 2 has a Layer 3 counterpart — comment-lint runs on full diff in CI, docs-verify runs on full diff in CI, secret scan runs on full diff in CI, template policy runs in CI. The pre-commit hook used to scope these checks to `--staged` files for speed, which created a divergence (local pass, CI fail). The hook now runs on full diff to match CI.

## Bypass philosophy

Every blocking gate has an env-var bypass for one reason: emergencies happen, and silent-bypass is worse than explicit-bypass. When you set `CONSTRUCT_SKIP_*` in your shell history, the override is visible to future-you, reviewers, and audit logs.

The gate authors trust the override system because they trust the bypass *is* the audit trail. Never patch around a gate by editing the gate itself.

## Where to look when something is blocking

| Symptom | Likely gate | Where to start |
|---|---|---|
| Edit got rejected with "banned pattern" | Layer 1 comment-lint | [`rules/common/comments.md`](https://github.com/geraldmaron/construct/blob/main/rules/common/comments.md) |
| `git commit` refuses with "comment policy violations" | Layer 2 comment-lint | run `construct lint:comments` locally |
| `git commit` refuses with "code changed but docs unchanged" | Layer 2 doc-coupling | update `CHANGELOG.md` or pass `CONSTRUCT_SKIP_DOCS=1` |
| `git push` refuses | Layer 2 pre-push | local test/build/evals/docs failed, OR remote CI was red |
| `gh pr create` refuses | Layer 2.5 template policy | `construct lint:templates --body-file=path/to/draft` |
| CI green but PR can't merge | Layer 3 branch protection | required status check missing or pending |
| Session won't end | Layer 3 policy-engine Stop | red CI, open beads, or drive criteria — output tells you which |

[Cookbook → Fix a policy violation](/cookbook/fix-a-policy-violation) walks the most common failures end-to-end.
