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

**Amended (Gerald, 2026-08-21): the per-push approval gate is lifted.** Commit locally per bead as usual; push as part of normal session completion, same as the un-amended block above — no separate ask first. This sits inside the wider amendment below: approval-for-approval's-sake is gone, and a session should reach "done" without a round trip through Gerald where the round trip isn't buying anything. What still gates on him is named explicitly there, not implied by silence here.

**Standing amendment (Gerald, 2026-08-21): infer intent, lean on available sessions and models for validation, don't ask by default.** The instruction that prompted this: "I would like to challenge the legacy approach which requires so much of my approval. I would like to infer intent but lean more heavily on this claude code session or my cursor session / models for validation rather than spending anything. I want everything done and over with." Read plainly: stop treating Gerald's approval as the default checkpoint for things a session can resolve itself; where something needs validating, use sessions and models already running (this one, Cursor) rather than either asking him or spending on new external validation (a paid hosted-model pass, external review, recruited users). This extends the existing [[Gerald stakeholder protocol]] and LLM-as-judge conventions rather than replacing them — those already established that label/verdict work doesn't wait on Gerald; this removes the remaining process-only approval points (push, routine spend within what a session already has access to, "should I proceed" on reversible work) on the same reasoning.

What this does NOT change, because these were never approval gates in the first place — no amount of inferred intent substitutes for a fact that doesn't exist yet:
- A bead whose acceptance is *Gerald's own subjective read* (a stakeholder-acceptance packet, "does this make you more confident," an interview where he is the interviewee) cannot be self-certified. A session producing that verdict itself isn't inferring his intent, it's replacing his answer with its own and calling it his.
- A bead measuring whether a model tracks *Gerald's own judgment* (construct-3ft's proxy-tracking question is the standing example) is circular if a delegate model supplies the reference verdicts — the measurement would grade the model against itself.
- A bead needing a licensed professional (construct-7xrl's attorney review) needs an actual attorney; a model cannot become one by being granted more autonomy.
- A bead needing a real external target that doesn't exist (a real Jira project, a real GitHub repo with real content, live work in a different repo) needs that target, not permission. Building a scratch/disposable stand-in to close a mechanical acceptance line (a probe trace, a connector test) is in scope under this amendment; producing the substantive deliverable itself against fabricated ground is not — that is exactly the fabrication commitment 15 exists to catch, redirected at Gerald instead of at a citation.

New spend still gets named, not silently taken: an eval-gate pass or anything else billed beyond what a session's own paid access already covers stays a stated line in the bead, same as before — "don't ask by default" is not "don't disclose."

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
- `npm run probe:opencode -- --binary /opt/homebrew/bin/opencode --model <model>` — host conformance against the pinned OpenCode version. The model comes from the sourcing rule below, not from a local server.
- `scripts/hooks/repo-gate.mjs` runs the same checks at commit time and never blocks; treat its output as CI arriving early.

## Architecture Overview

- `src/kernel/` — host-agnostic core. Only `kernel/paths.ts` may read env or home; everything else receives an injected `Paths`. Storage is built-in `node:sqlite` (zero dependencies); the work log is append-only, enforced by DB triggers rather than caller discipline.
- `src/hosts/` — host adapters behind the kernel's seam. OpenCode is pinned (`src/hosts/opencode/pin.ts`) with every depended-on behavior written as a named, probed expectation.
- `src/cli/` — the spine: `outcome`, `work`, `log`, `inbox`, `decide`, plus `doctor`, `version`, `cleanup`.
- `STRATEGY.md` carries the phase plan and commitments; `GLOSSARY.md` the vocabulary (parity is linted).

## Conventions & Patterns

- Commit messages: a plain-language first line stating the invariant or behavior, ending with the bead id — `A timeout that may not fire is not a timeout (construct-byd)`. No attribution trailers of any kind.
- **No bead ids in committed code (Gerald, 2026-08-05).** AI-authored code — source, tests, scripts — never references tracker bead ids, in code or comments; the comment states the invariant in plain language instead. Lineage lives in the commit message trailer and the tracker. Human authors may cite beads; AI does not unless a user directs it. Enforced by `scripts/lint-no-bead-refs.mjs` (part of `npm run lint`); root documents (STRATEGY, CHANGELOG, RESEARCH-DECISIONS, GLOSSARY) are the drift record and keep their dated bead lineage; tracker tooling and the labeling kit handle ids as data and are exempt by name.
- **Documentation states what is true now, and the root records are not exempt (Gerald, 2026-08-21).** Point-in-time framing rots, so it is stripped wherever it appears: "as of `<date>`", "currently", "today", "now", "recently", "at the time of writing", and any status restated in a second place where it will drift. This supersedes the clause above that kept STRATEGY, CHANGELOG, RESEARCH-DECISIONS and GLOSSARY as an append-only narrative. A claim that has been settled and superseded is rewritten to the settled state rather than preserved as a stack of amendments a reader has to replay; git history and the tracker hold the lineage, and a document that makes someone reconstruct the present from its own edit log has failed at its only job.

  One thing does not strip, and it is the reason for the rule rather than an exception to it: **a date that is evidence provenance stays.** When a figure was measured, which model family and version produced it, which host version was probed, which corpus a sweep ran over, when a licensed reviewer accepted something. Commitment 15 says anything called working carries a test, a probe, or a recorded run, and a recorded run nobody can date is not a record. So "miss rate 0.280, measured 2026-08-05 on claude" keeps its date; "as of 2026-08-05 the direction is decided" loses it and states the direction. In CHANGELOG the version headings and their dates are provenance and stay; rotting prose inside an entry does not. Bead lineage in root documents splits the same way: cited where it points at a record a reader would go open, dropped where it is decoration.
- **Development work runs on Gerald's subscriptions, never on a local model (Gerald, 2026-08-21).** Every model call made *to build or verify this repository* comes from Claude Code or Cursor: the `claude` CLI, `cursor-agent`, `codex`, or a host pointed at one of them (goose reaches Claude Code through its `claude-code` provider). Ollama and other local servers are not an approved source for probes, harness runs, trials, or measurement arms. This is about where a model comes from, not about cost: subscription capacity needs no approval, and "it was free" is not a reason to use a local model. Where a probe target can only be exercised on a model no subscription reaches, that is recorded as a gap in the pin or the packet, never worked around by quietly running something local.
  This governs development only. It says nothing about what a *user* of Construct may configure: a user who chooses a free or local model still gets that choice honored, and the honest-degradation path exists for exactly that.
- Measured gates over asserted claims: anything called working carries a test, a probe, or a recorded run (commitment 15).
- Fixtures and tests never touch the real HOME; the sterile harness (`tests/harness/sterile.ts`) roots everything in a tmpdir.
