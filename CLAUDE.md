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

1. `bd ready && bd blocked && bd orphans && bd stale` — the graph's own view first.
2. Every closed bead names a landing commit on main: `git log --oneline main --grep="construct-<id>"`. A close with no commit is either undone work or work stranded on an unmerged branch (`git merge-base --is-ancestor <sha> main` decides which).
3. Every in_progress bead matches actual work in flight (`git status`, worktrees). Claim what you are working (`--claim` sets the assignee; set `--status=in_progress` explicitly too); release what you are not. `bd orphans` flags beads named in commit messages that are still open — usually work that landed without a close, but a commit can legitimately reference a bead it did not finish (construct-506.4's failed publish), so read before `--fix`.
4. Every CHANGELOG promise ("tracked as a follow-up") names a bead that exists — and if that bead is closed, the promise sentence itself is now the stale artifact.
5. New work is filed with its dependency edges at creation time. A bead discovered mid-task is filed immediately, with its edge, not remembered for session close.

**Recording rules:**

- bd refuses epic->task edges. When the true dependency is narrower than an epic, record it as a dated NOTES entry on the bead (construct-r67's notes are the house pattern).
- Every drift fix is a dated NOTES entry on the affected bead. A silent fix recreates the drift.
- Statuses are facts, not intentions: claim on start, close on land, never before.
- Every landing commit ends with its bead id: `(construct-<id>)`.

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
- Measured gates over asserted claims: anything called working carries a test, a probe, or a recorded run (commitment 15). A corpus and the thing it measures must not share an author (construct-gsf).
- Fixtures and tests never touch the real HOME; the sterile harness (`tests/harness/sterile.ts`) roots everything in a tmpdir.
