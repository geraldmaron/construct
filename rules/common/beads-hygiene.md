---
description: Beads issue tracker hygiene contract.
---
# Beads Hygiene: Project Contract

Beads (`bd`) is the canonical durable tracker for Construct. Beads only earn their keep when their state matches the world. Stale "open" issues pollute `bd ready`, hide real work, and let agents propose work that already shipped. Every agent (human or AI, on any platform) is responsible for keeping the tracker honest.

## When to update beads

| Event | Required action |
|---|---|
| About to start non-trivial work | A Beads issue exists. `bd ready` to find or `bd create` if missing. `bd update <id> --claim` before edits. |
| Work lands on `main` | `bd close <id> --reason="Landed in PR #N. Verified: <file:line evidence>"`. Do not wait for someone else to notice. |
| Direction reverses mid-work | `bd supersede <old-id> --with=<new-id>`. Do not edit the old description in place. |
| Issue scope expands | Update the description and acceptance criteria in the same change that broadens scope. |
| A blocker is discovered | Add the dependency with `bd dep add <id> <depends-on>` so the readiness queue reflects reality. |
| A bead becomes irrelevant | `bd close <id> --reason="No longer needed because <why>"`. Do not leave it open hoping someone closes it later. |
| An existing memory contradicts current behavior | `bd remember --key <key> "..."` to update in place. Do not let future agents read stale "facts". |

## Pre-work checks (every session)

Run before planning, before claiming work, before proposing changes:

1. `bd ready`: surface unblocked work.
2. `bd list --status=in_progress`: verify nothing has been left mid-flight by an earlier session.
3. `bd stale`: surface anything untouched past the staleness window.
4. Cross-check the open list against `git log --oneline -20 origin/main`: close anything whose work actually landed.

If any of these surface drift, fix it before starting new work. Drift you observe and ignore becomes drift the next agent inherits.

## Post-work checks (every commit / push)

After the code changes land in main:

1. The bead the work was claimed against is closed with evidence in the reason.
2. Any beads superseded by the change are marked superseded, not left open.
3. New beads exist for follow-up work that was discovered but not done: file them in the same session, not "later".
4. `bd doctor` and `bd preflight` should run before push and report clean.

## What goes in a bead

| Field | Standard |
|---|---|
| Title | Imperative, scoped, parseable. "PR 3: `construct intake` CLI" beats "intake CLI". |
| Description | Why the bead exists + what success looks like. State the new shape directly. Do not preserve a "current behavior must keep working" goal unless the user explicitly asked for migration. |
| Acceptance criteria | Numbered, binary checks. A reviewer can answer pass/fail without re-reading the description. |
| Dependencies | Wire `bd dep add` whenever order matters. Implicit ordering rots into parallel work that breaks each other. |
| Notes | Verification evidence and decisions made *during* the work, not the original framing (description owns that). |

## What does **not** belong in a bead

- Internal-tracker references inside committed artifacts (CHANGELOG, commit messages, code comments, user-facing docs). Bead ids live in the bead, in `bd close --reason`, and in `.cx/context.md`. They do not leak into the public surface.
- Vague placeholders like "investigate X". Either there is a question to answer (`bd note` it on a parent), or there is concrete work to do (file the concrete work).
- Multi-phase epics with no children. Either decompose into the actual issues at filing time or mark the parent `[epic]` and file children before claiming.

## Hard rules

- **No claim, no edit.** If you are about to modify files, the bead exists and is claimed by you.
- **No close before verify.** "Tests pass" without `npm test` evidence is not done. Reason field carries the evidence.
- **No silent supersede.** Both the old and new bead reference each other; the old's close-reason names the new.
- **No drift past the session boundary.** If you observed drift but did not close/supersede/file, you have not finished the session.

## Bypass

There is no authorized bypass. Beads hygiene is a release gate. If the tooling is genuinely broken (e.g., dolt lock contention, `bd` crash), state the problem, file a bead for the broken tooling, and use `construct beads ...` lock-aware commands while it is being fixed. "I'll update beads later" is not a valid path.

## Automation

Project-level automation is tracked in the beads queue: auto-close on merge, pre-push `bd preflight` gate, weekly drift report, memory-contradiction detection. Until that ships, hygiene is a per-session discipline.
