---
title: closed-bead-sha-reachable live run + remediation (2026-07-16)
description: First live run of the ADR-0091 headline invariant against this repo's real bd/git history — accuracy fixes made to the check itself, and the disposition of what's left after those fixes.
intake: none
---

# `closed-bead-sha-reachable-from-main-or-annotated` — live run + remediation

`construct-4uxq0.12.3` landed the invariant (`lib/oracle/invariants/closed-bead-sha-reachable.mjs`) but only exercised it against synthetic fixtures. This note is the first live run against the real corpus (`bd list --status closed --json --limit 0`, 1813 closed beads) and what followed from it.

## Headline number

**Before any fix in this pass:** 75 violations + 58 unresolved = 133 flagged, out of 397 SHA-citing beads.
**After the two fixes below:** 64 violations + 30 unresolved = 94 flagged, out of 383 SHA-citing beads.

39 flagged items were eliminated as invariant false positives — not by editing bd records, but by making the check itself more accurate. Zero real violations were suppressed by either fix (verified: the violation count only ever went down via the rewritten-SHA fallback finding *genuine* evidence, never via the extraction fix, which only ever removed non-SHA tokens from the unresolved bucket).

## Fix 1 — rewritten-SHA fallback (`findSupersedingCommit`)

Squash/rebase merges change the SHA a close reason cited at close time. The work is real and lands on `origin/main`, just under a different hash. Example: `construct-vzg2i.2`'s close reason cites pre-rebase `b79dd1c6`, which is not reachable from `origin/main` — but `origin/main` carries `17787d8f`, whose commit message is `fix(orchestration): loud prepare-only statement at entry, not just run metadata (construct-vzg2i.2)`, naming the bead by id.

The fix: when the literal cited SHA doesn't resolve as an ancestor of `mainRef`, search `mainRef`'s log for a commit whose message names the bead's own id (`git log <mainRef> --grep=<beadId> --fixed-strings`). Only a *single* match counts — an ambiguous grep proves nothing and must not launder a real violation. This resolved 24 of the 39 eliminated items (11 violations, 13 unresolved).

## Fix 2 — false-positive SHA extraction

The naive `\b[0-9a-f]{7,40}\b` pattern matched three classes of hex-shaped text that are not commit SHAs, found by inspecting the actual unresolved-bucket entries rather than assuming they were real:

1. **Filename-embedded hashes** — `construct-neq9.7`: `tests/functional/regression-run-02158a157d53.functional.test.mjs` (the fixture name, not a commit).
2. **Model-version date suffixes** — `construct-f8w6.1`/`.2`: `claude-haiku-4-5-20251001` (the `-20251001` release-date suffix).
3. **Audit-event fingerprints** — `construct-d32e` and 11 others: `identical fingerprint 0833aee255ba0780` / `09fa29124b9a9182` (a dedup hash for a *duplicate audit record*, explicitly not a commit reference).

Checked against the full 1813-bead corpus before shipping the fix: 5 hyphen-preceded hex matches total (all class 1/2, zero legitimate hyphen-prefixed SHA citations), 12 fingerprint-prefixed hex matches total (all class 3, zero collisions with a real citation). Both exclusions are additive filters over the existing candidate set — they cannot suppress a real SHA unless that SHA itself happens to be immediately preceded by a hyphen or the word "fingerprint", which does not occur anywhere in the current corpus. `construct-f8w6.1`'s close reason also demonstrates the filter does not over-exclude: after skipping the false-positive `20251001` token, extraction correctly falls through to the real citation `2dcc5cf9` later in the same string.

Both fixes are covered by unit tests in `tests/oracle-invariants-closed-bead-sha.test.mjs` using the exact real strings above, not paraphrased fixtures.

## What's left (94 flagged, evaluated 2026-07-16)

| Category | Count | Disposition |
|---|---|---|
| Reachable only from `feat/wjap9-p1.2-graph-vocabulary` (this branch, pushed) | 29 | Self-resolves when this branch merges to `main`. No action. |
| Reachable only from another already-tracked pushed branch (`fix/ws-b-followups` ×4, `feat/cross-source-watch` ×1, `chore/ws-a-truth-hygiene` ×1) | 6 | Already covered by [pr-reconciliation.md](pr-reconciliation.md) — PR #408/#409/#410 disposition. No new action. |
| Real commits, exist locally, unreachable from **any** branch (local or remote) | 29 | **At risk of `git gc` pruning.** Preserved locally as `refs/preserve/<bead-id>` → sha (2026-07-16); not yet pushed. Needs per-bead investigation: most likely squash/rebase orphans (same root cause as Fix 1) that didn't happen to have their bead id in a surviving commit message. |
| SHA-shaped token not resolvable locally at all (never fetched, or genuinely fabricated) | 30 | Unresolved — no local evidence either way. Needs `git fetch --all` freshness check + per-bead investigation. |

The 29-row "dangling, no branch" and 30-row "not found locally" lists (bead id, cited SHA) are the working set for `construct-4uxq0.16` — see that bead for the current, machine-generated list rather than duplicating it here (this doc records methodology and disposition, not a live snapshot that will drift).

## Preservation refs

```
git for-each-ref refs/preserve
```

29 refs, one per at-risk bead (`refs/preserve/<bead-id>` → the cited SHA), created locally on 2026-07-16 to keep those commit objects reachable and safe from `git gc --prune`/`git prune` while `construct-4uxq0.16` is open. **Not pushed to `origin`** — that's a separate, explicit decision (these are historical commits of unknown provenance/relevance; pushing them to the shared remote permanently is a judgment call for whoever picks up `.16`, not an automatic side effect of finding them).

## Re-running this yourself

```
node bin/construct oracle invariants --json | node -e '
  const d = JSON.parse(require("fs").readFileSync(0,"utf8"));
  const inv = d.invariants[0];
  console.log(inv.status, "violations:", inv.violations.length, "unresolved:", inv.unresolved.length);
'
```
