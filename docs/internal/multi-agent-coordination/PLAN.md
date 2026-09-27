# Construct: safe multi-agent coexistence, cross-host coordination, and a professional-capability gap fix

## Bounded delegation amendment (September 27, 2026)

The delegation request supersedes this plan's original no-launch and no-new-tool
boundaries. Continue on the existing coordination foundation; keep native work
as the only writer and do not restore another tracker. The current host remains
lead, and Claude, Codex, and Cursor may each be configured as local subscription
workers. Live three-tool capability is not yet established.

Current implementation and operating limits are documented in
`docs/bounded-delegation.md`; implementation evidence and remaining release
gates are in `docs/internal/multi-agent-coordination/DELEGATION-VERIFICATION.md`.
This file is the canonical plan location, not the former audit scratchpad.

Critical path: native delegation contract, all three adapter paths, isolated
snapshots, bounded supervision, review dispositions, serial integration,
combined-result validation, and live compatibility in all six directions for
both review and implementation. Host wiring and permission probes are release
gates. Professional-capability and template work remains next/later in this
plan, not a prerequisite for delegation.

The implementation uses read-only worker tools and returned patch proposals.
Construct applies a proposal only inside its isolated worktree after path,
file-type, and read-only-snapshot checks. This avoids granting unattended
write bypasses. Worktrees are editing isolation, not a security boundary;
operator-recorded live permission evidence is still required to enable a CLI.
The `delegate` contract adds lead-only `triage` and `integrate` alongside
`start`, `status`, `result`, and `cancel`, so acceptance cannot be inferred from
a successful worker exit. No commits, pushes, publishing, or credential changes
are authorized by dispatch or integration.

Strongest failure mode: a CLI changes authentication, inherited customization,
or sandbox behavior while its wrapper remains installed. Alternative: manual
coexistence without a launcher. Verdict: accepted with controls for the guarded
implementation; live compatibility and productivity remain needs-validation.

## Context

**Why this change.** Gerald wants multi-agent work to be a general, host-agnostic Construct capability:

- Any number of sessions from any MCP host (Claude Code, Claude Desktop, Cursor, Codex/ChatGPT, OpenCode, Gemini CLI, Goose, future hosts) can work in the same project(s).
- Each session may spawn subagents, often in git worktrees.
- They coexist without corrupting state or duplicating or clobbering work.
- Each knows what the others are doing, and can hand off or communicate where the host allows.

He also sees recurring hook and MCP errors, wants templates that aren't thin boilerplate, and wants Construct to act like a professional team member. That covers context and relationships across systems, research from declared and external sources, cross-context risk, challenge, role-bounded action, and stakeholder framing.

**What was done.** A read-only research and audit, run as four workflows (about 165 agents):

- nine audit dimensions plus a completeness critic and five follow-ups (`wf_2a92d162-d8f`);
- a subagent, worktree, delivery-channel and prior-art dimension (`wf_32ed5e02-783`);
- a three-design panel with three adversarial judges and a synthesis (`wf_69291a18-e64`).

It produced 237 findings, each checked by an independent adversarial verifier: 0 refuted, about half narrowed to a corrected claim. Load-bearing claims were then spot-checked directly in source; see the Verification record below.

The full design (`synthesis.md`) and the raw verified findings (`wf1.json`, `wf2.json`) are in the session scratchpad: `the audit scratchpad`. Execution step 1 copies them into the repo, because the scratchpad is ephemeral.

## Outcome summary

- **Recommendation: build it, in dependency order.** Most of the work repairs things Construct already owns: the store, claim identity and fencing, worktree binding, and the approval holes. The bounded-delegation amendment adds one interactive MCP tool; coexistence remains available without enabling it.
- **Realistic now, on every local MCP host:**
  - no lock errors;
  - exactly one claim winner;
  - worktree agents see the same ledger as main;
  - nothing completed or approved in someone else's name;
  - a peer's claim or edit overlap shows up on your next Construct call (on the next tool call where the host has safe hooks).
- **Not realistic:**
  - mid-turn messages between vendors (MCP 2026-07-28 can't carry them, and server notifications never reach a model);
  - proving which subagent made a call when the host doesn't say;
  - stopping an agent that never calls Construct on a host without hooks (only git catches it);
  - cloud agents (Cursor cloud, Codex cloud, ChatGPT web) taking part live.
- **Boundary:**
  - **Construct owns the durable record:** who is working, what each holds (fenced claims and path leases), what happened, what one agent left for another, and who may approve.
  - **Hosts own:** model execution, sandboxes, their own live messaging (Claude SendMessage and agent teams), and permission prompts. Construct's opt-in host adapters own bounded local invocation and isolated worker worktrees.
  - **Git owns** merge.
  - **Nobody builds:** agent chat, a relay for cloud agents, a machine-wide coordination database, wake-up or long-poll tools, A2A or ACP endpoints.
- **Top risks:**
  1. Exclusion below the session level is cooperative.
  2. Hooks could reintroduce the error storm, or fail closed in Cursor.
  3. A format bump could strand older launchers on Gerald's machine.

  Controls for each are in the challenge record.

## Decisions (resolved 2026-09-24)

| # | Decision | Resolution |
|---|---|---|
| D1 | Store under `<commonDir>/construct/` for bare-repo worktree layouts | Declined by default. Bare layouts are refused with a clear message. |
| D2 | STRATEGY 1: a read-only view of **declared, mutually related** projects' stores | **Gerald approved.** Relative locators, read-only open, facts only, never a write. Add a one-line clarification to STRATEGY 1 and a RESEARCH-DECISIONS entry when Phase 3 lands. |
| D3 | Machine-wide coordination database | Declined (kill list: home database). |
| D4 | Top-tier approvals (`external_write`, `destructive`) and `accepted`/`final` require a person channel, even in bypass mode | **Gerald approved.** |
| D5 | Live conformance on Gerald's subscriptions | Decided by default. Claude Code and Cursor first; Codex, Gemini and OpenCode gated on measured need. Development calls come from subscriptions only. |
| D6 | Clean dead 2.x entries in global host configs | **Gerald approved: the session cleans, with backups.** Diff shown first; only named dead entries removed. Codex atlassian/linear/notion/slack are moved out of the corrupted markers, not deleted, unless confirmed unused. |
| D7 | Rotate the plaintext Supabase token in `~/.cursor/mcp.json` (exposed in audit tool output; appears in 4 local transcripts) | **Gerald's action.** Move it to a 1Password reference per `~/Developer/Guides/Secrets-1Password.md`. |
| D8 | Publish alpha.26 after Phases 0 and 1; repin agx-research off alpha.24 | Gerald's action (sessions never publish). |
| D9 | Commit `.construct/{project,constitution,sources,registry.lock}.json` in this repo | Decided by default. STRATEGY 1 already puts project truth in the repository, and worktrees need it. |

## Confirmed gap register (condensed)

Severity is the verifier's. Ids refer to `wf1.json` and `wf2.json`.

### Errors Gerald is seeing, by source

| Source | Status | Construct-caused? |
|---|---|---|
| **Repo hook failing.** `.claude/settings.json` runs `scripts/hooks/no-fabrication-lint.mjs`. That script imports `src/kernel/verify/claims.ts`, which was deleted in `27b010b7`, so every Write/Edit fails, in Claude Code and in Cursor (Cursor imports Claude hooks; 340 failures). | **Active** | Yes (repo) |
| **Codex 2.x block.** `~/.codex/config.toml` holds a 2.x block with corrupted, interleaved markers. 4 servers fail at every Codex thread start, and a `filesystem` server is rooted at `/`. Three trusted projects carry dead `construct-mcp` entries. | **Active** | Yes (2.x residue) |
| **Cursor unbound entry.** `~/.cursor/mcp.json` has a `construct-mcp` entry with no `--project`, launched from `$HOME`. It failed 258+ times up to 2026-09-20, and now serves unbound. | Active (degraded) | Yes (residue) |
| **OpenCode 2.x residue.** The global plugin imports a 2.x module; the `construct` agent calls 2.x tools; the `construct-local` agent runs on Ollama. VS Code `mcp.json` files point at deleted 2.x servers. | Latent / active | Yes (residue) |
| **Transient lock at serve start.** The server stays unbound and tells the agent to run `init`. | Latent | Yes (3.x) |
| **2.x hook storm.** About 97k global plus thousands of project "Cannot find module" errors, 2026-07-17 to 08-21. It stopped only because ai-workflow-config repointed the hooks (`7c26e1b`). 3.x can't detect any of this residue: `construct cleanup` was removed in `da1dcbb5`. | Resolved externally | Yes (2.x) |
| **Spark extension.** The Claude Desktop Spark extension's CLI is missing (742 errors). | Active | No |
| **Gerald's own hooks.** `validate-written-file` rejects JSONC tsconfig files; `block-no-verify` times out. | Intermittent | No (ai-workflow-config) |

### S. Store safety (reproduced by experiment)

- **S1 Lock errors under concurrency.** `src/kernel/state/open.ts:74-75` opens with the rollback journal and busy_timeout 0, so 30–60% of concurrent calls fail with "database is locked". This regressed from the pre-3.x store (WAL plus 5000 ms timeout, removed in `27b010b7`). *Critical.*
- **S2 Transactions switch off after one lock.** In `transaction()`, `depth += 1` runs before `BEGIN IMMEDIATE` (`open.ts` ~96), which sits outside the `try`. One BUSY leaks the depth, so the process then runs every later "transaction" statement by statement. Partial writes were reproduced. *Critical.*
- **S3 Unbound for the session.** A transient lock at startup leaves the server unbound for the whole session. *High.*
- **S4 Silent migration.** Read-only `status` and `doctor` silently migrate the format. The older pinned build then refuses the store and suggests `reset`. *High.*
- **S5 Untested and over-permissive.** No test runs more than one process, and the DB is created 0644. *Medium.*

### A. Coexistence

- **A1 Worktrees can't reach the shared store.** Binding stops at the worktree's `.git` file. The CLI says "run init", and following it forks a second store under the same project id. Worktree-local stores vanish silently on `git worktree remove`. `MANDATE.md:152` requires one identity across linked worktrees. *Critical.*
- **A2 Claims don't exclude same-host sessions.** The claim owner is `person via <client>` (`src/cli/broker-context.ts:76`), so same-host sessions and subagents re-claim each other's items. MCP `work complete` passes no token, `submit_work` trusts an owner supplied by the caller, and expired claims never return to ready. *Critical/high.*
- **A3 No real session or agent identity.** Identity is `client:pid`: `clientInfo` is ignored and host session and agent ids go unread. Subagents share the parent's serve process. *High.*
- **A4 Worktree agents act on the wrong checkout.** Via the pinned `--project`, they reach the right DB but resolve files against the main checkout. *High.*
- **A5 No coordination primitives.** There are no presence, activity, handoff or path-reservation primitives; `scope_json` is never read. The instructions say "do not spawn another agent" (`server.ts:28`, `skills/construct/SKILL.md:80`), and docs say nothing about parallel agents. *High/medium.*

### T. Authority holes that coordination would amplify

- **T1 Approvals minted in Gerald's name.** Via `decide`, any model session can mint `external_write` or destructive approvals recorded as the person. The provenance fix was lost in the cutover. *Critical.*
- **T2 Approvals transfer to the claimer.** Tier and capability are checked against the run starter, not the claimer. Lease tokens are guessable. *Critical.*
- **T3 Self-promotion.** `promote_deliverable` lets the same caller go challenged, then accepted, then final. *High.*
- **T4 Everything recorded as the person.** Every interactive act is recorded as the person. `remember` forges "user" provenance. The "data, not direction" framing and the injection tests were deleted. *High.*
- **T5 Starvation and switched-off safeguards.** Stale leases can starve other sessions' work, and `destructiveHint:false` on every tool switches off host safeguards. *High/medium.*

### P. Professional capability

Works end to end today: directory sources, `remember`, the work ledger, and workflow runs driven by an interactive host. The rest is a data model with no flow, or absent.

- **P1 Directory sources only.** No host ingestion contract exists for GitHub, Jira, docs or web reads. *High.*
- **P2 Lossy directory reader.** It stops silently at 200 files while reporting `capped:false`, merges files from different repos that share a relative path, appends duplicate claims on every refresh, and admits `.env`. *High.*
- **P3 Relationships and propagation missing.** Relationship and identity confirmation has no caller, and a change in repo B never reaches repo A. *High.*
- **P4 Inert staff model.** Staff, roles and missions govern nothing. Standing grants and break-glass have no surface. *High.*
- **P5 No stakeholder or research layer.** There is no stakeholder, framing or negotiation capability, and no research workflow; the method skills aren't bound into any workflow. *High.*
- **P6 Routing errors.** "Log into staging…" routes to `remember` at 0.9, outward acts are judged low-stakes, coordination has no class, and there is no eval corpus. *High.*
- **P7 Unenforced gates.** The contradiction gate is unreachable and sensitivity labels aren't enforced. *Medium.*

### Q. Templates and validators

- **Two tiers of quality.** The 7 method skills are substantive. The 9 packs are thin clones: doctrine 2/5, and `sources.md` admits the sources were never opened while carrying "Reviewed: 2026-09-02".
- **Gates accept junk.** All 8 review workflows accept an "n/a" summary, an uncited "critical" finding and evidence ref "x", and still end `validated`. Behind this:
  - `evidence_refs_resolve` is inert.
  - "Deterministic checks" steps are self-reported by the model.
  - Deliverable schema ids are never resolved.
  - `review_complete` and `plan_complete` are wired into nothing.
- **"Qualified" means files exist.** 9 of 11 activation evals are tautological. The description budget sits at 7979/8000.
- **Stale personal copies.** The copies in `~/.claude/skills` have drifted from the repo, and `first-run` is an orphan from alpha.19.

### H. Host hygiene and wiring

- **H1 No hygiene check.** `doctor` can't see residue, and reports healthy for broken or foreign wiring.
- **H2 Missing hosts.** Codex can't be wired automatically; Gemini CLI and Claude Desktop aren't supported.
- **H3 Consumers run the dev checkout.** Every consumer project and the global bin run the live dev checkout with an absolute fnm path; admin-app's served version flips between alpha.24 and alpha.25.
- **H4 No live conformance.** Conformance never exercises live hosts, multiple sessions or worktrees, and the flagship project never onboarded itself.

## Recommended design

Adopted from the synthesis: the isolation-first base, grafted with the strongest parts of the ledger-native and bridge designs, with all 23 judge must-changes applied.

### Identity: Construct mints the only identity that carries authority

- **Session.** `ses_<randomUUID>` is minted once per serve, CLI or hook process in `bindingFor` (`src/cli/broker-context.ts:72-77`). It is the claim, lease and grant owner, and the actor of record. A reused PID inherits nothing.
- **Host-reported ids.** `CLAUDE_CODE_SESSION_ID`, hook `session_id`, `conversation_id` and `sessionID`, and `initialize.clientInfo` are stored as attributes labeled with their source. They are used only for continuity and joins, and never for authority.
- **Read at the adapter edge only.** A new `src/hosts/identity.ts` sits beside `ambient.ts`; `tests/harness/sterile.ts` clears its keys.
- **Agents.** `<ses>/<agent>` with attestation `host` or `reported`, attested by the PostToolUse hook row joined within 10 s. Agent identity drives attribution and per-agent claim ownership, never authority. Unlabeled calls are recorded as `<ses>/main`.
- **Kernel principal.** The kernel receives a `Principal {sessionId, agent, attestation, host, model, channel}`; `actor` stops saying "person" unless a person channel was used.
- **Capabilities.** `hostCapabilitiesFor` stops granting `write_project_files` and `run_tests` just because a session is interactive.

### Store: Phase 0 prerequisite

**`src/kernel/state/open.ts`:**
- `PRAGMA busy_timeout=5000`.
- WAL set once with jittered retry; `synchronous=NORMAL`.
- Directory 0700, file 0600. Reuse `git show 27b010b7^:src/kernel/store/open.ts`.
- Depth increments only after BEGIN succeeds, with three jittered retries; nested calls use `SAVEPOINT`.
- `stampFresh` uses `BEGIN IMMEDIATE` plus `IF NOT EXISTS`.
- If the filesystem refuses WAL, stay in DELETE mode with the timeout and have `doctor` warn.

**Open errors are classified** as `no_project`, `worktree_no_store`, `locked`, `newer_format`, `older_needs_migrate` or `permission`. A lock retries for 10 s, then binds lazily on the next call. Construct never tells anyone to `init` or `reset` for a lock or a newer store.

**Migration is explicit.** A new `construct migrate` takes a `VACUUM INTO` backup first. Read-only commands open with `readOnly:true`. Every `tools/call` re-checks `schema_version`, and a stale server refuses to write.

**Workflow atomicity.** Start dedupe and `concurrency:single` move inside the create transaction. `claimNext` does gate plus claim in one transaction.

### Worktrees and projects

- **One store per logical project,** at `<mainRoot>/.construct/state/construct.sqlite`.
- **Resolution.** `resolveRepository(cwd)` reads `.git`, `gitdir` and `commondir` (file reads only, no subprocess) to find `mainRoot`.
- **Configuration** is read from `mainRoot`. Evidence and file resolution use the caller's lane: a `checkout` argument that must share the common dir, else the hook `cwd`, else the serve's lane.
- **Refusals.** `init` inside a lane is refused, naming the main store. A DB copied into a lane is never opened. Bare repos are refused (D1).
- **Wiring.** `serve` resolves from cwd, so `--project` becomes an override only, and init stops writing absolute paths into committable files. The directory source skips nested worktrees.
- **Clones** are separate stores. `work export`/`restore` carries a `projectId` check.
- **Cloud clones** come up `detached-clone`, with no live participation.
- **Related projects (D2).** Mutually declared `related:[{id, relativePath}]` allows a read-only peer view for staleness and handoff pointers.

### Coordination primitives (format 4, additive)

- **`sessions` and `session_agents` tables.** Presence is last-seen; an idle but living session looks stale, so takeover keys on claim state, not presence.
- **Fenced work claims.**
  - A random nonce token; every renew, complete, release, cancel and handoff requires it, from the same session too.
  - `takeover {reason}` only on expiry, when the holder is gone, or after a 2 h quiet cap.
  - A sweeper modeled on `expireDeadLeases`.
  - Implicit renewal on any Construct call from the holder.
  - Migrated owners become `legacy:<label>`.
- **Step leases.** Owner comes from ctx, never input. `heartbeat` works on both surfaces. An expiry caused by a different owner doesn't spend the attempt budget.
- **`path_leases`** (repo-relative, prefix overlap, checked per work item):
  - same lane, exclusive: refused, naming the holder;
  - different lanes: `merge_risk` warning (policy can refuse);
  - `readinessOf` blocks on paths held in the same checkout.
- **Handoff is a work-item transition, not a message.** `work handoff {token, packet:{state, next, watchOut, where, openQuestions}}`, then `work accept` re-issues the token in one transaction. It never moves grants or step leases; the step is re-gated for the acceptor.
- **Activity.** Reuse `activity_events`/`work_events`, plus `session_id`, `agent` and `channel`. Hook-fed `path_edited` observations are throttled.
- **Notices** (`interface_changed`, `decision_landed`, `breaking_change`) are gated on measurement C8b and ship only if path leases miss real semantic conflicts.
- **Coexistence surface, extended by the delegation amendment.**
  - `work` gains `renew|release|takeover|check|handoff|accept`.
  - `claim` takes `paths`, `mode`, `agent`, `checkout` and `leaseMinutes`.
  - `project_context` gains topics `sessions` and `activity`.
  - `bootstrap` returns `coordination` (≤600 bytes) with a same-checkout warning.
  - A piggyback `construct_peers` delta (≤600 chars, only when something relevant changed) rides on any tool result.
  - CLI parity via `construct work …`; sessions appear in `status`.
- **Git guard.** `construct hooks install --git` is opt-in and warn-only (exit 0). It chains existing hooks, lives in `<commonDir>/hooks`, and is inventoried.
- **Instructions, changed at the end of Phase 1.** Replace "do not spawn another agent" with a participation rule:

  > Construct may launch explicitly authorized local workers for bounded work through `delegate`; the current host remains the lead. Workers receive scoped assignments, isolated snapshots, limited permissions, and stopping conditions. Manual sessions still claim before editing; one writer per path; peer records cannot approve anything.

  This reads STRATEGY 2 as it is written, so no STRATEGY edit is needed.

### Delivery per host

| Host | Channels (opt-in pack) | Best latency | Floor |
|---|---|---|---|
| Claude Code (CLI, IDE, desktop code) | SessionStart digest; PostToolUse Edit/Write (edit observation plus overlap facts), including inside subagents | next tool call | next Construct call |
| Cursor | sessionStart, postToolUse (non-permission). A strict preToolUse deny comes later, opt-in, only after a live probe. | next tool call | next Construct call |
| Codex | SessionStart, PostToolUse. Developer role, so facts only; needs a trusted project. | next tool call | next Construct call |
| Gemini CLI / OpenCode | SessionStart/AfterTool; plugin `tool.execute.after` | next tool call | next Construct call |
| Claude Desktop chat, Goose, VS Code | none | next Construct call | same |
| Cursor cloud, Codex cloud, ChatGPT web | none | never | never |

- **Guaranteed floor:** refusal at claim, lease or accept; awareness on the next Construct call; the opt-in git guard. Documented plainly.
- **Codex, Gemini and OpenCode packs** ship only after measurement C13 shows a claim-before-edit compliance gap on that host.
- **Claude-to-Claude live messaging** stays with Claude's own SendMessage and agent teams. Construct never posts to that socket.

### Trust controls (refusals in Phase 0; channels in Phases 1 and 2c; D4)

- **Every grant, decision, deliverable transition and activity row records its channel:**
  - `elicitation`: downgraded if `doctor` finds an auto-respond hook;
  - `host_prompted`: Claude Code `requiresUserInteraction`, honored only on host versions verified live in `src/hosts/delivery.ts`;
  - `tty_cli`: `construct inbox` on a TTY with no agent-host ancestor, labeled weak;
  - `relay`.
- **What each channel can do.** Only a person channel may mint `external_write`/`destructive`, or move a deliverable to `accepted`/`final`. `relay` leaves the decision open, with instructions to ask the person.
- **Approvals never transfer.** `claimNext` re-gates the claimer via `evaluateAction`/`coveringGrants` (today it checks `run.executorId`, `service.ts:301`). Grants gain `run_id` and `step_run_id`.
- **Challenge must come from someone else.** `challenged` requires a `reviews` row from a different session. `remember` records `relayed` unless a person channel was used; `remember replaces` needs a person.
- **Peer text is data.**
  - Tool results wrap it as `{origin, trust:'data', text}`, escaped.
  - Hook output on every host carries ids, paths, times and states only; never note, handoff or title bodies.
  - Bodies are screened for secrets.
- **Tool annotations.** Per-tool annotations: `destructiveHint:true` on `decide`, `promote_deliverable` and the terminal `work` actions; `requiresUserInteraction` on `decide`/`promote`.
- **Tests restored.** The injection tests deleted in `27b010b7` come back.

### Hook contract (answers the 2.x hook storm)

- **Registration.**
  - Project-local, machine-local files only: `.claude/settings.local.json`; `.cursor/hooks.json` excluded via `<commonDir>/info/exclude`.
  - Nothing global, and no permission events in v1 on any host.
  - Installed by `construct hooks install --host=`, recorded in `.construct/state/installed.json`; uninstall restores each file byte for byte.
- **Command.**
  - An inline `sh -c` with no PATH dependency. It resolves the common dir via git, reads a machine-local `.construct/state/launcher` (node execPath plus launcher), and exits 0 on anything missing.
  - `CONSTRUCT_HOOKS=off` kills it.
- **Inside `construct hook`:**
  - project resolved from the payload `cwd`;
  - a 1.5 s self-timer against the host's 5 s;
  - store opened read-only with a 200 ms busy timeout, and write failures swallowed;
  - output empty or schema-valid for the event, always exit 0, facts only (≤400 bytes);
  - health recorded to `.construct/state/hook-health.json`.

## Challenge record (verdict: accepted with controls)

- **Strongest failure mode.**
  1. Claude subagent B, sharing its parent's serve, never calls Construct and edits `open.ts`.
  2. Sibling A holds a lease on `src/kernel/state/`.
  3. A Cursor agent in worktree `../b` claims `open.ts`.

  Cursor correctly gets `merge_risk`. B's clobber of A is caught only by the PostToolUse edit observation if the pack is installed, else only at commit by the git guard.

  **Controls:** leases checked per work item; edit observations; the same-checkout warning; the participation rule; worktree isolation recommended for parallel writers; the git guard. C13 measures compliance so the gap is a number.
- **Second failure mode.** Cursor imports Claude hooks as fail-closed permission hooks. **Control:** v1 registers no permission events, and a live Cursor probe gates any addition.
- **Best alternative not chosen: "fix the store, defer coordination to hosts."** It's cheaper, but it gives no cross-vendor exclusion. The documented duplicate-work incident was Cursor on main against Claude on a branch, and only a shared store sees both. Adopting agent-coord was rejected because it would be a second authority over claims.
- **Assumption inversions.**
  - Agents skip Construct: store correctness still holds, and edit observations, the git guard and worktrees carry the load.
  - A sandbox forbids writing the main store from a lane: MCP stays the write path with a clear EPERM message, and there is never a lane-local fallback.
  - Minted ids are forgeable by a same-user process: tokens stop accidents and stale workers, not a hostile local process. The docs say so.
- **Who pays.**
  - Gerald: person-channel prompts on the top tiers (D4), one `construct migrate` per project, and opting in to hooks.
  - Agents: ≤600 chars per call, only on change.
  - The solo maintainer: per-host hook churn (hence opt-in and gated).
- **Controls.** Refusals ship before any peer text; no permission-event hooks before the probe; explicit migrate with backup; per-call format re-check; `tests/concurrency/` on Node 22.18 in CI; the quiet cap; the same-user threat model documented.

## Phased roadmap

**Gate for every phase:** `npm run lint && npm run typecheck && npm test && npm run smoke`, plus the phase gate below. CI runs Node 22.18. Each phase's full finding list, files and acceptance criteria are in `synthesis.md` §E, which gets copied into the repo.

### Phase 0: stop the bleeding

**Goal:** no lock errors, no partial writes, no broken repo hook, no silent migration, no approval laundering or transfer, and a clean machine.

**Changes:**
- **Store (as above).** `src/kernel/state/{open,format,migrate,schema}.ts`; `src/cli/{context,serve,status,doctor}.ts`; new `construct migrate` in `src/cli/commands.ts`; `src/hosts/mcp/server.ts` (lazy bind, unbound text, per-call format check).
- **Workflow atomicity.** `src/kernel/workflow/service.ts`: dedupe inside the transaction; atomic gate plus claim; `ready -> waiting_for_decision`; `decide` refuses `relay` for the top tiers; `promote` refuses accept/final without a person channel (`tty_cli` until elicitation lands); `claimNext` re-gates the claimer.
- **Annotations.** `src/kernel/broker/definition.ts`.
- **Repo hook.** Delete the `no-fabrication-lint` entry from `.claude/settings.json` along with the script, since its scope (`packs/`, `deliverables/`) no longer exists. Add `tests/hooks/committed-hooks.test.ts`: every committed hook runs from a subdirectory with a fixture payload and exits 0.
- **Machine cleanup (D6).** Back up each file, show the diff, then remove only the named dead entries:
  - the Codex 2.x block, including `filesystem /`, with live servers re-homed outside the markers;
  - `[agents.construct]` and `~/.codex/agents/construct.toml`;
  - the dead `construct-mcp` in trusted projects;
  - the unbound `construct-mcp` in `~/.cursor/mcp.json` and `admin-app/.cursor/mcp.json` (rewired via `init --client=cursor` where wanted), never printing header or env values;
  - the OpenCode 2.x plugin and the `construct`/`construct-local` agents (a backup dir already exists);
  - dead VS Code servers;
  - the orphan `~/.claude/skills/first-run`.

  Then refresh `~/.claude/skills/construct` from the repo.

**Reuse:** `27b010b7^` store code; `tests/harness/sterile.ts`; `evaluateAction`/`coveringGrants`; `cli/inbox.ts`.

**Acceptance:**
- 12 processes × 50 `work add`, plus 3 serves × 200 mixed calls: 0 locked, exact row count, `integrity_check` ok, WAL on.
- A forced BUSY on BEGIN leaves 0 partial rows.
- A serve started under a 3 s EXCLUSIVE lock is bound within 10 s, with no "init" text.
- `status` leaves a format-3 file byte-identical.
- An older build facing a newer store says "upgrade", never "reset".
- MCP `decide approve` on `external_write` creates 0 grants.
- A grant for A doesn't release B's claim.
- `destructiveHint:true` on `decide` and `promote`.
- After cleanup: a new Codex thread shows 0 Construct-caused MCP startup errors; a Claude Code Write/Edit in this repo shows 0 hook errors.

### Phase 1: identity, worktrees, claim fencing (format 4)

**Goal:** unique minted identity, fenced and expiring claims, one store across lanes, and honest attribution. Commit `.construct/*.json` here (D9). Change the instructions text at the end of the phase.

**Files:**
- new `src/hosts/identity.ts`, `src/kernel/state/sessions.ts`, `src/kernel/work/sweep.ts`;
- `src/cli/broker-context.ts`, `src/kernel/broker/{context,tools}.ts`;
- `src/kernel/work/service.ts`;
- `src/kernel/state/{steps,schema,migrate,grants,decisions,activity}.ts`;
- `src/cli/{context,init,work,inbox}.ts`, `src/kernel/project/*`, `src/hosts/wiring/clients.ts`;
- `src/kernel/paths.ts` (delete the dead `localStateDataDir`);
- `skills/construct/SKILL.md`, `docs/`.

**Reuse:** `claimStep`/`settle` fencing, `StaleLeaseError`, `expireDeadLeases`, `workflow_runs.session_id`/`executor_id`.

**Acceptance:**
- Two `serve --client=claude-code`: B's claim of A's item is refused, naming A.
- Token-less complete, same-session re-claim without a token, and B submitting A's owner/token are all refused.
- A claim expires into `work ready` after one sweep; a late complete gets `StaleClaimError`.
- Takeover after the quiet cap records its reason.
- A reused PID and a spoofed `CLAUDE_CODE_SESSION_ID` inherit no grant.
- 0 MCP rows carry `person` without a person channel.
- Worktrees (nested `.claude/worktrees/a` and external `../b`, with `.construct` committed and untracked):
  - identical `work list`, one DB realpath;
  - `init` refused in a lane;
  - `serve` from a lane without `--project` binds main with `lane` set;
  - `git worktree remove` loses nothing;
  - a copied DB is ignored;
  - a foreign `checkout` and a foreign `projectId` restore are refused.
- Migrated v4 equals fresh v4 in `sqlite_master`.

**Gate:** `node --test tests/concurrency/ tests/cli/worktree.test.ts`.

### Phase 2: coordination and delivery

- **2a primitives.**
  - Path leases, handoff/accept, activity, piggyback, `bootstrap.coordination` with the same-checkout warning.
  - The git guard; the participation rule; a coordination class in the router.
  - Parallel-agent rules in `docs/first-run-and-hosts.md`.
  - Honor `notifications/cancelled`.
- **2b hook packs.** Claude Code first, then Cursor after the live import probe (D5).
- **2c elicitation.** Outbound request map, `clientCapabilities.elicitation`, "pending person confirmation" within 60 s.

**Files:**
- new `src/kernel/work/leases.ts`, `src/kernel/coord/awareness.ts`, `src/cli/{hook,hooks}.ts`, `src/hosts/hooks/{claude-code,cursor}.ts`, `src/hosts/delivery.ts`;
- `tools.ts`, `server.ts`.

**Acceptance:**
- Lease outcomes: same-lane exclusive refused; cross-lane `merge_risk`.
- After A claims, B's next result carries `construct_peers`; a quiet call carries none.
- 1,000 randomized accept interleavings across 4 processes: 0 double holders.
- `bootstrap.coordination` ≤600 bytes with 5 sessions.
- The git guard warns, exits 0 and chains.
- S10 (injection: 0 grants, 0 resolutions, 0 promotions; bodies only inside `trust:'data'`) and S11 (1,000 hook invocations across 12 failure states: 0 non-zero exits, ≤2 s) pass.
- The live Cursor probe is recorded.

**Gated:** notices (C8b); Codex, Gemini and OpenCode packs (C13).

### Phase 5: host hygiene and wiring (parallel after Phase 0)

- **Read-only `doctor` sections.** `host-hygiene` and `hooks` resolve every hook command and MCP entry across Claude, Cursor, Codex, OpenCode and VS Code user and project configs. They flag 2.x paths, unbound entries, missing scripts, orphaned or diverged planted skills, and entries pointing into a git working tree. They print keys, file and line only; they never print values or edit global files.
- **Wiring.** Codex `ClientWiring` (project `.codex/config.toml`, TOML-aware, entry-based); Gemini CLI and Claude Desktop wiring; `construct skill prune` with consent.
- **Pinned installs.** Consumer projects wire a pinned install, not the dev tree. No absolute paths in committable wiring.
- **Protocol.** Echo the protocol version; handle `roots`.
- **Fixes.** `--dry-run --no-wire` made accurate; OpenCode `permission: ask` for `decide`/`promote`; doc drift fixed; `construct-plnm` (legacy global store) resolved.

**Acceptance:**
- A sterile HOME with fixture residue: `doctor --json` reports each item with file and line, and every mtime is unchanged.
- `init --client=codex` passes conformance.
- Uninstall restores byte for byte.

### Phase 3: professional capability

1. **Host ingestion contract.** `sources record {sourceId, reads:[{locator, digest, excerpt, kind}], claims}` admits GitHub, Jira, docs and web reads the host made, with `host_read` provenance at per-claim-type authority. No connectors are built.
2. **Directory source repairs.** Entities keyed by `(source_id, path)`; refresh supersedes instead of appending; honest cap; `.gitignore` respected, dotfiles and `.env` excluded; async.
3. **Relations.** Propose, then confirm via `inbox`. Manifest dependencies become `depends_on`. Refresh marks dependent premises stale. Cross-project staleness goes through the D2 read-only view; add the STRATEGY 1 clarification and a RESEARCH-DECISIONS entry here.
4. **Roles bind authority.** A role binds maxTier, capabilities and obligations to a session via a person channel (obligations, not personas: STRATEGY 10). Add a grants list/revoke/create surface on the person channel.
5. **Research workflow.** `research-and-recommend` binds investigative-research and decision-framing: ingest, compare approaches, get a different-session challenge, and record a decision with rationale, options, owner and review date.
6. **New `stakeholder-communication` method skill.** Audience and interest map; loss/gain framing (Tversky and Kahneman); SCQA/pyramid; sequencing asks and pre-wiring; bad news; interests versus positions (Fisher and Ury). Sources opened and dated; a recorded real-work run. Also a cross-context-risk method built on context-mapping's typed relations. Settle the description budget first (Q).
7. **Gates.** Drift rule 5 made reachable; sensitivity filtered on `project_context` reads; a secret screen before admission.
8. **Routing.** Build a ≥200-sentence labeled class and consequence eval first. Then add outward-act and non-engineering stakes vocabulary; unset scale → standard; the `remember` prefix doesn't fire when a work verb follows.

**Acceptance:**
- A 541-file repo is fully admitted, or reports `capped:true` with the count.
- Two same-named READMEs make 2 entities; 3 refreshes leave 1 claim set.
- A host-recorded Jira read appears as evidence.
- A dependency change marks the premise stale.
- No role or grant without a person channel.
- `.env` is never admitted.
- The eval's per-class precision and recall are recorded; outward acts come back `confirmBeforeProceeding:true`.

### Phase 4: template and validator substance

**Changes:**
- `evidence_refs_resolve` receives `resolvableRefs` (ingestion records plus lane files) at `submit_work` (`tools.ts:413`).
- Substance validators reject placeholders and uncited findings, and treat severity at or above a threshold as material.
- Real JSON Schemas for the declared deliverable ids, with pack templates bound to the step contract.
- "Deterministic checks" steps implemented as named validators, or renamed to what they are.
- `review_complete`/`plan_complete` wired in.
- `qualified` requires a recorded behavior-eval run; `scripts/evals-live.mjs` becomes the live fixture runner, using a cross-family judge from subscriptions.
- Pack `sources.md` files are actually opened and dated. The test changes to require `opened:<date>` or an explicit unverified marker.
- One authoring grammar; `skills/README.md` fixed.
- Description budget: packs that run inside workflows are excluded from the host listing.

**Acceptance:**
- templates-01's junk replay fails in all 8 workflows.
- A citation to an unread source fails.
- A same-session challenge is refused.
- Each pack has 1 recorded real-work run.

## Verification

1. **Multi-process harness (`tests/concurrency/`).** Real child processes under the sterile harness, with serves spawned as in `scripts/conformance.mjs:67` and an injected clock.
   - S1 load: 2/4/8 serves plus 12 CLI writers plus a hook loop give 0 lock errors, p95 write <250 ms at N=8.
   - S2 claim race: exactly 1 winner in each of 100 rounds.
   - S3 terminal actions without a token are refused.
   - S4 expiry, `kill -9` and quiet cap behave as specified.
   - S5 depth leak: 0 partial rows.
   - S6 bind under lock succeeds.
   - S12 an old serve during migrate refuses to write.
2. **Conformance.**
   - Layer B (credential-free, `npm run conformance`): scripted multi-serve interleavings per host profile, checking that the observed latency class matches `src/hosts/delivery.ts`.
   - Layer C (live, D5): two Claude Code sessions plus an `isolation: worktree` subagent, cursor-agent, then gated hosts, each in its own worktree of a scratch repo under a sterile HOME. It records identity per host, latency, hook errors (target 0 over ≥200 events per host), and prompts on `decide`.
   - Every matrix cell is marked verified-live, documented-only, or untested.
3. **Incident replays, with before and after numbers.**
   - stash or branch switch with a live peer;
   - `git add -A` sweeping a peer's file;
   - the same item done by Cursor on main and Claude on a branch;
   - a lost close under contention;
   - 3 identical `start_outcome` calls giving 1 run;
   - two sessions picking the same schema number;
   - C8b semantic conflict.
4. **Authority tests (`tests/security/`).** T1–T8 cover: a relay decide makes 0 grants; accept/final need a person; the claimer is re-gated; handoff moves no grant; `tty_cli` is refused under an agent ancestor; an auto-respond hook downgrades elicitation; `host_prompted` counts only on verified versions; no grant keys on a spoofed id. Plus S10 injection and S11 hook fail-safety.
5. **Dogfood (Phase 2 exit, D4 input).** One week on this repo after alpha.26:
   - Claude Code in main with a worktree subagent;
   - a Cursor agent in `../construct-b`;
   - both hook packs and the git guard installed.

   Measure daily: duplicate-work incidents (target 0 among callers), claim-before-edit compliance per host, overlaps caught by hook versus at commit, hook errors (0), lock errors (0), approvals by channel, and injected tokens per session-hour. Record in VERIFICATION.md.

**Verification record for this plan (what was actually observed):**
- Findings: 237 across 4 workflows, each checked by an adversarial verifier; 0 refuted.
- Reproduced by experiment in the scratchpad: lock errors, the transaction-depth leak, the same-host double claim, the worktree fork, and junk deliverables reaching `validated`.
- Personally spot-checked in source: `open.ts` (no WAL/timeout; BEGIN outside the `try`), `broker-context.ts:76` (`person via ${client}`), `server.ts:28` and `SKILL.md:80` (spawn text), the lint hook's missing import, `MANDATE.md:152`, and STRATEGY 1–3.
- **Not run:** any live host session. Every per-host claim marked [validate] in `synthesis.md` must be probed before it is relied on.
- Items needing live probes before relying on them:
  - Cursor's import mapping, and fail-closed behavior on imported hooks;
  - `updatedInput` on MCP tools, and a per-subagent id in `tools/call` `_meta`;
  - `CLAUDE_CODE_SESSION_ID` per version;
  - Codex project hooks path;
  - OpenCode plugin failure behavior;
  - sandboxed writes from lanes;
  - the elicitation version each host negotiates.

## Execution protocol

1. **Branch and persist.** Before touching the shared checkout, check `ps` and `git reflog` for other live sessions. Work on `feat/multi-agent-coordination` off `staging`, in a worktree if another session is live. First commit: copy `synthesis.md` to `docs/internal/multi-agent-coordination.md` and the condensed register to `docs/engineering/audit-2026-09-24.md`. Code comments never cite tracker ids.
2. **Record the work.** File one native-ledger work item per phase slice (`construct work add`) with its acceptance criteria. Observations stay observations.
3. **Order.**
   - Phase 0.
   - Then Phase 1, and Phase 5 in parallel on a separate lane.
   - Then Phase 2 (2a, then 2b Claude, then the Cursor probe and 2b Cursor, then 2c).
   - Then Phases 3 and 4.
   - Commit each coherent slice, with a subject that states the invariant; no attribution trailers.
4. **Gate.** Run the full gate after every slice, and the phase gate at each phase end.
5. **Gerald's actions.** Rotate the Supabase token (D7), publish alpha.26 (D8), and approve each push.

## Parking lot (reported, not Construct's)

- **Spark Claude Desktop extension:** install its CLI or remove the extension.
- **ai-workflow-config hooks:** `validate-written-file` should tolerate JSONC tsconfig files, and `block-no-verify` needs a longer timeout.
- **agx-research** is vendored on alpha.24 and shares identity per host; the fix is repinning after alpha.26 (D8).
