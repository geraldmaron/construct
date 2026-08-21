# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->

**Override to the block above (Gerald, 2026-08-03):** `git push` runs only with Gerald's explicit per-push approval. Commit locally per bead as usual; at session close, ask to push rather than pushing. A session that ends with approved-but-unpushed commits is complete; a session that pushed without asking is not.

## Reconciliation Ritual (construct-eng)

The tracker and the repo drift apart the moment either moves without the other. Reconciliation is a ritual run at the session boundaries — start and close — not a rescue sweep run when things already look wrong. The dependency chain is living: it is edited the moment reality changes, not batched for later.

**The sweep:**

0. `npm run reconcile` — steps 2 and 3 below, run rather than remembered (construct-fnn). It reconciles the exported bead set against the repo and reports both directions of both disagreements. The same check runs warn-only on every commit via `scripts/hooks/repo-gate.mjs`, so a session that ends abnormally still leaves the drift visible. Its output is read, not obeyed: both classes have known benign causes, which it prints.
1. `bd ready && bd blocked && bd orphans && bd stale` — the graph's own view first.
2. Every closed bead names a landing commit on main: `git log --oneline main --grep="construct-<id>"`. A close with no commit is either undone work or work stranded on an unmerged branch (`git merge-base --is-ancestor <sha> main` decides which).
3. Every in_progress bead matches actual work in flight (`git status`, worktrees). Claim what you are working (`--claim` sets the assignee; set `--status=in_progress` explicitly too); release what you are not. `bd orphans` flags beads named in commit messages that are still open — usually work that landed without a close, but a commit can legitimately reference a bead it did not finish (construct-506.4's failed publish), so read before `--fix`.
4. Every CHANGELOG promise ("tracked as a follow-up") names a bead that exists — and if that bead is closed, the promise sentence itself is now the stale artifact.
5. New work is filed with its dependency edges at creation time. A bead discovered mid-task is filed immediately, with its edge, not remembered for session close.

**Recording rules:**

- bd refuses epic->task edges. When the true dependency is narrower than an epic, record it as a dated NOTES entry on the bead (construct-r67's notes are the house pattern).
- Every drift fix is a dated NOTES entry on the affected bead. A silent fix recreates the drift.
- A disagreement that is benign rather than fixable is *adjudicated*, in a NOTES line the reconcile reads: `YYYY-MM-DD DRIFT ADJUDICATED (<direction>): <why>`. The direction is one of `closed-without-commit`, `open-but-named`, `claimed-but-idle`, `in-flight-unclaimed`, and naming it is what keeps the verdict tied to the disagreement it was about — a bead that later drifts the other way is reported again. Adjudicated beads are counted, not listed, so the working list holds only what still needs a person. Write the reason a stranger could check (a sha on main, a file that exists, the child that carried the trailer), never just "benign".
- The lost-record sweep (the reconcile's second witness, comparing the export's own history against its current self) is adjudicated the same way, with two more directions: `lost-close` for a bead history shows closed and the export no longer does, `missing-filing` for an id history shows filed and the export no longer carries at all. Branch lag — a checkout just sitting behind another ref — produces both shapes without anything really being lost, so this is how that noise gets quieted instead of refiled. `lost-close` goes in the bead's own notes like the four directions above. `missing-filing` has no bead left to carry it, so the documented equivalent is a note on *any* current bead that names the id explicitly — this epic (construct-eng) is the practical default home — e.g. `DRIFT ADJUDICATED (missing-filing): construct-ab12 was branch lag, never merged.` The id must be spelled out because nothing about where the note lives can supply it.
- `bd update --notes` **replaces** the field. Read the existing note and append, or the record you are protecting is the one you destroy.
- Statuses are facts, not intentions: claim on start, close on land, never before.
- in_progress means a session is working the bead right now. The moment the next move belongs to Gerald (a token to mint, labels to accept, a decision to make), release the claim, set status back to open, add the `human` label, and write a NOTES line naming exactly what that move is. `bd list --label=human` is Gerald's queue; a bead sitting in_progress across sessions is drift by definition, including sessions that end abnormally.
- Every landing commit ends with its bead id: `(construct-<id>)`.

**LLM-as-judge (Gerald, 2026-08-04):** label and verdict work runs as recommend-and-accept: Fable (or the strongest available model) labels or recommends, Gerald accepts, then work proceeds — no external recruiting gates a study. Every such verdict's NOTES entry names who judged and who accepted. When the judging model shares a family with whatever authored the thing being judged, the correlated-error caveat travels with the numbers wherever they are quoted (observed agreement is an upper bound on independent agreement).

**Amended (Gerald, 2026-08-05):** Gerald is the stakeholder, not a coder in the loop. He clarifies requirements and approves outputs; label and verdict production never waits on him. The strongest available model labels autonomously, cross-family panels supply independence where correlated error matters, and each verdict's NOTES entry names the judging model(s) under this standing approval. No bead depends on Gerald "providing labels"; the `human` label is reserved for genuine stakeholder moves — requirement clarifications, output approvals, external actions (tokens, attorneys, users). Any bead whose description assumes human-provided labels is reread under this amendment.

**Dispatch protocol (generalized from construct-2jb, 2026-08-04):** a bead intended for autonomous execution — a fresh session, any host, possibly a multi-agent stream — carries a dated `DISPATCH` NOTES entry stating:

1. Minimum model tier, as a capability floor, not a vendor lock ("Fable/Opus-class", "Sonnet-class or better", "any local model"). If the bead splits, state the judgment/mechanical split and a tier for each half.
2. Self-containment: the description + acceptance criteria must carry everything a fresh session needs — file paths, the shape to copy, what must NOT be done. If executing requires chat history, the bead is not dispatchable yet; fix the bead.
3. The close gate: which checks must pass before `bd close` (default: the full repo gate).

A bead without a DISPATCH note is human-or-interactive by default; do not fan it out to agents.

**Worktree agents (2026-08-20, from a reproduced incident):** uncommitted state in a linked worktree is volatile — treat it as already lost. An agent working in a worktree commits a checkpoint before any long-running step and never parks work-in-progress uncommitted; the `reset: moving to HEAD` entry every worktree's reflog carries at creation is git's own internals, not evidence of interference. `bd` invoked from inside a worktree resolves the main checkout's workspace — run tracker commands from the main checkout only.

## Build & Test

No build step: TypeScript is erasable-syntax only, run natively by Node >= 22.18 type-stripping.

```bash
npm run lint && npm run typecheck && npm test && npm run smoke
```

That line is the full gate; nothing is "done" without it. Pieces:

- `npm test` — `node --test` over `tests/` (no framework dependency).
- `npm run smoke` — `scripts/smoke-packaged-install.sh`: pack, install into a scratch project, run the spine as a consumer would.
- `npm run probe:opencode -- --binary /opt/homebrew/bin/opencode --model ollama/qwen3.5:4b` — host conformance against the pinned OpenCode version, on a local model so re-verification costs nothing.
- `scripts/hooks/repo-gate.mjs` runs the same checks at commit time and never blocks; treat its output as CI arriving early.

## Architecture Overview

- `src/kernel/` — host-agnostic core. Only `kernel/paths.ts` may read env or home; everything else receives an injected `Paths`. Storage is built-in `node:sqlite` (zero dependencies); the work log is append-only, enforced by DB triggers rather than caller discipline.
- `src/hosts/` — host adapters behind the kernel's seam. OpenCode is pinned (`src/hosts/opencode/pin.ts`) with every depended-on behavior written as a named, probed expectation.
- `src/cli/` — the spine: `outcome`, `work`, `log`, `inbox`, `decide`, plus `doctor`, `version`, `cleanup`.
- `STRATEGY.md` carries the phase plan and commitments; `GLOSSARY.md` the vocabulary (parity is linted).

## Conventions & Patterns

- Commit messages: a plain-language first line stating the invariant or behavior, ending with the bead id — `A timeout that may not fire is not a timeout (construct-byd)`. No attribution trailers of any kind.
- **No bead ids in committed code (Gerald, 2026-08-05).** AI-authored code — source, tests, scripts — never references tracker bead ids, in code or comments; the comment states the invariant in plain language instead. Lineage lives in the commit message trailer and the tracker. Human authors may cite beads; AI does not unless a user directs it. Enforced by `scripts/lint-no-bead-refs.mjs` (part of `npm run lint`); root documents (STRATEGY, CHANGELOG, RESEARCH-DECISIONS, GLOSSARY) are the drift record and keep their dated bead lineage; tracker tooling and the labeling kit handle ids as data and are exempt by name.
- Measured gates over asserted claims: anything called working carries a test, a probe, or a recorded run (commitment 15).
- Fixtures and tests never touch the real HOME; the sterile harness (`tests/harness/sterile.ts`) roots everything in a tmpdir.
