<!--
rules/common/commit-approval.md — explicit approval contract for mutating git operations.

Hard rule enforced by lib/hooks/commit-approval.mjs (PreToolUse:Bash). No
agent may commit, push, or merge a PR without a user-written approval
marker. Scope and TTL are defined here and in lib/approve.mjs.
-->
# Commit Approval (hard rule)

Construct does not commit, push, or merge on the user's behalf without an explicit, time-bounded, user-written approval marker. This is a non-negotiable safety contract — the user is always the last decision-maker before history is mutated.

## What this covers

The PreToolUse hook `lib/hooks/commit-approval.mjs` blocks these Bash tool calls when no valid approval marker exists:

- `git commit` (any form)
- `git push` (any form)
- `gh pr merge` (any form)

Reads and other non-mutating git operations (`git status`, `git log`, `git diff`, `git fetch`, `git branch`, `git show`) are unaffected.

## What "approval" means

The user — not the agent — runs:

```
construct approve commit   [--duration 10m] [--count 1] [--branch <name>] [--reason <text>]
construct approve push     [options as above]
construct approve merge    [options as above]
```

This writes a JSON marker to `~/.cx/approvals/<action>.json` with:

- `createdAt` / `expiresAt` (default TTL: 10 minutes)
- `remainingCount` (default: 1 — consumed after a single operation)
- optional `branch` scope — if set, the operation is blocked unless the current branch matches
- optional `reason` — captured for audit

Inspect pending approvals with `construct approve status`; clear them with `construct approve revoke`.

## Agent behavior

- Agents MUST NOT run `construct approve` themselves. Doing so is equivalent to self-signing, which defeats the contract.
- When a commit/push/merge is needed, the agent states what it wants to do, shows the diff/plan, and **asks the user to run `construct approve <action>`**. Only after the marker exists does the agent attempt the operation.
- If the block fires, the agent surfaces the block cleanly: "Commit blocked — ask user for approval." Never silently retry, never suggest `CONSTRUCT_APPROVAL_BYPASS=1` as a workaround.

## Working branch

Every session-start prominently displays the current branch at the top of the injected context:

```
## Working branch: **<branch-name>**
```

Before any mutating operation, the agent must restate the branch so the user can confirm scope. Use `--branch <name>` on approval to pin the approval to that branch.

## Emergency bypass

`CONSTRUCT_APPROVAL_BYPASS=1` as an env var disables the block for the session. Logged loudly to stderr and to the audit trail so it is never invisible. Use only for broken-hook recovery; document in the session.

## Why this exists

The cost of a silent commit is asymmetric: it's cheap to block one and ask, costly to rewind a bad one. Every other safety rail (doctor, tests, linters) is advisory. This one is structural.
