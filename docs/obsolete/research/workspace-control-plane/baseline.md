---
intake: none
---

Obsolete: retained as historical workspace-control-plane research; Construct 2.0 uses Worker Profiles, Workspace Presets, and `.construct/` — see docs/obsolete/legacy-surface-register.md.

# Workspace Control Plane Program — Phase 0 Baseline

Captured: 2026-07-17 · Lead: main session (Fable tier) · Branch: `feat/workspace-control-plane` (cut from `main` @ `0dcb33c3`)

This file records the repo state at the start of the workspace-control-plane re-architecture
program. It is evidence, not analysis. Confidence labels: **confirmed** (observed directly),
**agent-reported** (returned by a bounded investigation agent, citations included in its report),
**unverified** (claimed by tooling, not independently checked).

## Source directive

The program executes an externally authored architecture directive (38 pages, read in full by
the lead this session):

| Field | Value |
|---|---|
| File | `~/Downloads/Construct V2 Architecture.pdf` (source filename retained for provenance only; the program itself uses no version-suffixed names) |
| Size | 178,704 bytes |
| sha256 (first 16) | `cdfcb0b27f3bb4b7` |
| Condensed requirements | [directive.md](directive.md) |

## Branch & working tree

- Branch cut: `feat/workspace-control-plane` from `main` @ `0dcb33c3`
  (merge of PR #408) at 2026-07-17 15:15 local. **Confirmed.**
- Working tree at cut: clean (see incident note below). **Confirmed.**
- The program works in a dedicated git worktree at
  `.claude/worktrees/workspace-control-plane` because the primary checkout is owned by a
  concurrent live session on `feat/bead-sprint-20260717`. **Confirmed** (three Claude
  processes and a foreign `git checkout` at 15:19:21 observed in `git reflog`).

### Incident record — shared-checkout contention at program start

Recorded so the next session does not re-derive it:

1. The concurrent sprint session had 11 uncommitted oracle-invariant files in the primary
   checkout. A stash (`WIP on feat/bead-sprint-20260717`, commit `4de83366`) was created at
   15:14:54, seconds before this program's branch switch.
2. This program's lead briefly removed 6 of those files from the shared tree (believing them
   strays on the new branch) while the sprint session was mid-`stash pop`. All files were
   verified byte-identical to their stash copies before removal, and all 11 were restored to
   the sprint session's tree (5 via its completed pop, 6 re-extracted from stash commit
   `4de83366^3`). Final state verified: `git status` on the primary checkout shows the same
   5 modified + 6 untracked oracle files as before the program started. **Confirmed.**
3. Lesson applied: program work moved to an isolated worktree; the primary checkout is not
   touched again by this program while another session owns it.

## Tooling health at cut

`construct doctor` (run from the program worktree after `npm ci`): **62 passed, 2 warnings,
2 failed.** **Confirmed.** The failures:

| Check | Detail | Assessment |
|---|---|---|
| Git hooks unwired | `core.hooksPath` is an absolute path into the primary checkout; the worktree expects `.beads/hooks` | Worktree artifact — pre-commit gates active in the primary checkout only |
| Cross-surface adapter parity | claude: extra `dispatcher` · opencode: missing `construct` | Pre-existing drift, not introduced by this program |

Warnings: `adapter-prune` (one `.cursor` adapter dir for an uninstalled host) and specialist
worker backend unset (plan-only mode). **Confirmed.**

## Tracker state at cut

- `bd ready`: 83 ready issues, headline epics `construct-tsyfe` (MCP/ACP readiness, demos,
  RichDocument, document ingestion), `construct-72gqn` (org-capability audit H-beads).
  **Confirmed** (session-start snapshot).
- Oracle overseer verdict: **degraded**, and stale (verdict dated 2026-07-11, 6 days old);
  oracle producer reported stalled with 5 approvals waiting. **Unverified** (session-start
  hook claim; not independently re-run this session).

## Graph subsystem state at cut

- Live dependency graph present in the primary checkout at `.construct/graph/`:
  3,250 nodes / 8,522 edges (16 node types, 16 edge relations). **Agent-reported**
  ([graph-and-state-audit.md](subagents/graph-and-state-audit.md)).
- The program worktree has no `.construct/` state tree of its own (gitignored, machine-local);
  graph numbers above refer to the primary checkout's state.
- The pre-change-intent graph work (`ff17508e`, `lib/graph/change-intent.mjs`) exists **only**
  on `feat/bead-sprint-20260717`, not on `main`, and therefore not on this branch.
  **Confirmed** (`git merge-base --is-ancestor` negative). Any program work that assumes it
  must first wait for that branch to land.

## Program directory

```
docs/notes/research/workspace-control-plane/
  baseline.md            ← this file
  directive.md           ← condensed source-directive requirements
  program.md             ← charter: waves, routing, naming and cleanup rules
  subagents/             ← bounded investigation reports (Wave 0)
  synthesis/             ← lead-authored synthesis and decisions
```
