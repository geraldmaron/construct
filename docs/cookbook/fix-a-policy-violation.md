---
title: Fix a policy violation
description: A commit is blocked, a push is refused, or CI is red. Find which gate fired and what to do about it.
---

Construct enforces policy in three places. If something's blocking, the gate's output tells you what fired and what to do. This walks the four most common failures end-to-end.

For the full enforcement model, see [Concepts → Gates and enforcement](/concepts/gates-and-enforcement). For an inventory of every gate, see [`construct gates:audit`](/reference/cli/diagnostics).

## "Edit blocked — comment policy"

**You see:** the agent tries to write a file, the write fails, output mentions `comment-lint` and a banned pattern (narrative voice, point-in-time note, noise sentinel, missing required header).

**What fired:** Layer 1, the real-time `comment-lint` PostToolUse hook.

**Fix:**

- Remove the banned phrase from the offending line. The hook output names the line and the pattern category.
- Common patterns: `// We do X` (narrative voice), `// Previously this was Y` (point-in-time), `// best effort` (noise sentinel).
- For new files in scoped paths (`bin/`, `lib/**/*.mjs`, `lib/hooks/`, `tests/`, etc.), add the file-header `/** */` block first.

**Emergency bypass:** `CONSTRUCT_SKIP_COMMENT_LINT=1` in the env. Use only when the failing check is the bug and the lint policy itself needs updating.

## "Commit blocked — code changed but docs unchanged"

**You see:** `git commit` refuses with `Code changed but CHANGELOG.md / docs / .cx/context not updated.`

**What fired:** Layer 2 `.beads/hooks/pre-commit` — specifically the `construct docs:verify` check.

**Fix:**

- Add an entry to `CHANGELOG.md` describing what changed.
- If the change is genuinely operational (a build script tweak, a config file update) and doesn't warrant a CHANGELOG entry, update `.cx/context.md` or relevant `docs/**` to reflect the work.
- The gate scope is `lib/`, `bin/`, `src/`, `app/`. Tweaks to `tests/`, `scripts/`, and `agents/` don't trip the gate.

**Emergency bypass:** `CONSTRUCT_SKIP_DOCS=1 git commit ...`. Use rarely; "I'll update docs later" is exactly the failure mode this gate exists to prevent.

## "Push blocked — last CI run failed"

**You see:** `git push` refuses with `[pre-push-gate] Last CI run on <branch> FAILED. Investigate before pushing more.`

**What fired:** Layer 2 `pre-push-gate.mjs` — the remote CI status check.

**Fix:**

```bash
gh run view --branch=$(git branch --show-current) --log-failed | head -50
```

Read the failure. Usually one of:

- A test flake (run `npm test` locally — does it reproduce?)
- A linter newly tripping (run the lint the failing job named)
- A dependency advisory (`npm audit --omit=dev --audit-level=high`)
- A real regression you missed

Fix the underlying cause, then push. The gate clears as soon as a new CI run goes green.

**Emergency bypass:** `CONSTRUCT_SKIP_PREPUSH=1 git push`. Use when the CI failure is a known false-positive that you've already fixed in the push you're attempting to make.

## "PR can't merge — required status checks pending or failed"

**You see:** GitHub UI shows the PR as not mergeable. One or more required-status-checks are pending, failed, or missing entirely.

**What fired:** Layer 3 branch protection.

**Fix paths:**

| Symptom | Action |
|---|---|
| Checks pending | Wait. CI is still running. |
| Checks failed | Open the failed job's log: `gh pr checks <pr> --watch` then `gh run view <run-id> --log-failed`. |
| Check missing entirely | The required-status-check name in branch protection doesn't match an actual CI job name. Check `.github/workflows/ci.yml` for the job's `name:` and reconcile with the GitHub branch protection settings. |
| Required check exists but never reports | The CI job didn't run on this PR. Check the workflow's `on:` triggers — does it run on `pull_request`? Path filters may be excluding your changes. |

For unblocking on a non-required job that's intermittently failing (e.g., a CDN timeout): re-run just that job from the GitHub Actions UI, or `gh run rerun <run-id> --failed`. Do this only after you've ruled out a real bug.

**Emergency bypass:** if you're a repo admin, you can dismiss required-status-checks for a specific merge. Don't make a habit of it — that defeats the whole layer.

## "Session won't end"

**You see:** Trying to end the session, `policy-engine` reports a blocking condition — red CI, open beads issues, or unmet drive criteria.

**What fired:** Layer 3 `policy-engine.mjs` Stop handler.

**Three causes, three fixes:**

1. **Red CI on the current branch** — fix the failure or `CONSTRUCT_STOP_OK_RED_CI=1` to acknowledge.
2. **Open `in_progress` beads issues** — close them with `bd close <id>` (or `bd update <id> --status open` to defer back to ready), or `CONSTRUCT_STOP_OK_OPEN_BD=1` to acknowledge.
3. **Drive mode active with unmet criteria** — set the criterion's `met: true` evidence in `.cx/drive-state.json`, or `CONSTRUCT_STOP_OK_OPEN_BD=1` for an explicit override.

## When the gates themselves are wrong

If you've been hitting a gate that's a false-positive — the lint flags content that shouldn't be flagged, the doc-coupling gate fires on a change that legitimately doesn't need docs — fix the gate, not the bypass:

- Comment patterns: `rules/common/comments.md` is the source of truth for what's banned.
- Doc-coupling scope: `lib/docs-verify.mjs` defines which paths trigger the gate.
- Pre-push job set: `lib/hooks/pre-push-gate.mjs` declares the local pre-push jobs.
- Branch protection required-status-checks: `gh api branches/main/protection/required_status_checks` is the source.

`construct gates:audit` is the audit tool — it walks all four enforcement surfaces and reports gaps. Run it when you're uncertain which gate fired or why.

## Reference

- [Concepts → Gates and enforcement](/concepts/gates-and-enforcement) — the full enforcement architecture.
- [`construct gates:audit`](/reference/cli/diagnostics) — surface gaps.
- [`construct doctor`](/reference/cli/diagnostics) — health checks including the wired-hooks-path check.
- [Comment policy: `rules/common/comments.md`](https://github.com/geraldmaron/construct/blob/main/rules/common/comments.md)
