---
intake: none
---

# Subagent Evidence Report: Install init sync upgrade audit

> Agent F · model: Haiku · type: Explore (read-only) · Wave 1 · supervised by Opus.
> Structured output rendered by Opus; findings are the subagent's, not yet adjudicated.

## 1. Summary

Init and setup write via skip-if-missing or marker blocks with one idempotent merge: .gitignore append is guarded by isPatternIgnored() to avoid double-entry. Sync uses two-phase staging and atomic renames with manifest tracking per-host. AGENTS.md/CLAUDE.md injection uses version+hash markers for dedup. Uninstall distinguishes manifest-tracked files from user-owned scaffold. Four findings: (1) init auto-starts services by default in non-interactive runs, controllable only via --no-start flag; (2) dirty-repo check is silent unless verbose; (3) init skips (never overwrites) .cx/context.json/md after first write but no guard prevents user drift; (4) HOME/XDG isolation is in code but lacks explicit end-to-end test coverage.

## 2. Evidence table

| Finding | Evidence (file · observation) | Confidence |
|---|---|---|
| Init writes .cx/context.json, .cx/context.md, plan.md via writeStampedIfMissing — skip-if-exists pattern, never overwrites | `lib/init-unified.mjs:799-826` — Lines 799-826 call writeStampedIfMissing three times. Each invocation checks fs.existsSync(filePath) first (in project-init-shared.mjs) and returns false (skipped) if file exists. Content receives cx_doc_id+body_hash frontmatter stamp but file is left alone if present. | confirmed |
| .cx/ and all IGNORED_PATTERNS added to .gitignore are idempotent via isPatternIgnored() guard | `lib/init-unified.mjs:889-904, lib/host-disposition.mjs:34-65` — missingIgnorePatterns() (line 892) filters IGNORED_PATTERNS by isPatternIgnored(), which checks for exact match, bare form, slashed form, or broader ** catch-all (host-disposition.mjs:54-59). Only missing patterns are appended (line 895-896), with no double-add possible. | confirmed |
| Sync uses two-phase write: stage to staging dir, then atomic rename + manifest tracking per-host | `scripts/sync-specialists.mjs:369-407, 898-916` — writeFile() at line 369 stages to stagingDir in dry-run or normal mode; commitStaging() atomically renames all pairs (line 403) then cleans staging tree. removeStaleAdapters() at line 898 reads manifest from .construct-manifest, compares against expected set, and deletes stale files not in current registry (line 909-913). | confirmed |
| AGENTS.md and CLAUDE.md receive marker-based injection: version+hash in BEGIN/END block, idempotent dedup | `lib/agent-instructions/inject.mjs:86-115` — injectConstructBlock() at line 86 computes shortHash(body) and checks existing block for matching v:VERSION hash:HASH (line 91). Same hash returns 'unchanged' (no write), different hash triggers 'updated' (replace block only). Preserves all surrounding content outside markers. | confirmed |
| Init auto-starts services by default in non-interactive runs; --no-start bypasses, but default is to start | `lib/init-unified.mjs:1209-1250` — Lines 1209-1211: shouldStart = !--no-start && (--auto-start \|\| !interactive). In non-interactive mode (no TTY), interactive=false, so shouldStart defaults true. Service startup runs at line 1223 unless --no-start is explicitly passed. No warning when auto-starting on upgrade. | confirmed |
| Dirty-repo check is silent unless verbose flag is set | `lib/init-unified.mjs:615-623` — preflight() at line 616 checks git status --porcelain and sets clean=false if modified files exist. Line 618 only warns if verbose=true (line 618: 'if (!clean && verbose)'). Default (non-verbose) silently accepts dirty repo and proceeds. | confirmed |
| Setup (.setup.mjs) writes ~/.config/construct/config.env and XDG user state, never project directory | `lib/setup.mjs:440-452, 606-624` — ensureUserConfig() at line 606 writes to getUserEnvPath(homeDir), resolved via XDG configDir in env-config.mjs. ensureWorkspace() at line 613 writes to stateDir(homeDir). No project-scope secrets written; uninstall test (init-no-project-secrets.functional.test.mjs:72-74) confirms no config.env lands in project tree. | confirmed |
| Uninstall distinguishes manifest-tracked adapter files (safe auto-delete) from user-owned AGENTS.md/plan.md (ask-risk) | `lib/uninstall/uninstall.mjs:117-141, 164-172` — project-agents category (line 116) reads .construct-manifest and removes only listed files via removeManifestEntries(). project-scaffold-files category (line 164) lists AGENTS.md and plan.md as ask-risk (line 154, default unchecked), users must opt-in. Code never force-deletes user-edited scaffold. | confirmed |
| Init does not overwrite existing .cx/context.md or .cx/context.json after first write, no drift guard | `lib/init-unified.mjs:809-826, lib/project-init-shared.mjs:10-15` — writeStampedIfMissing() returns early if fs.existsSync(filePath) is true (project-init-shared.mjs:10-12). User can manually edit .cx/context.md after init, and subsequent init runs will skip it. No marker or re-convergence logic to detect/warn about drift. | confirmed |
| Doctor is spawned non-blocking via spawnDetached() in service-manager.mjs, writes to .cx/doctor.json state file | `lib/service-manager.mjs:206-216, 180-189` — startDoctor() spawns 'node lib/doctor/index.mjs' detached with stdio redirected to runtimeStateDir/doctor.log (line 214). readDoctorState() reads .cx/doctor.json (line 185) and checks if process is alive via process.kill(pid, 0). State file is mutated by doctor daemon, not init. | confirmed |
| No explicit end-to-end test of HOME/XDG isolation during init or upgrade on dirty repo | `tests/functional/init-no-project-secrets.functional.test.mjs, tests/functional/doctor-no-repo-mutation.functional.test.mjs` — init-no-project-secrets.test.mjs (line 37-57) spawns init with isolated HOME env var and walks project tree to verify no secrets. doctor-no-repo-mutation.test.mjs (line 66) also uses mkdtempSync HOME. However, no test explicitly verifies that init on a dirty repo (uncommitted changes) does not trigger service startup or mutate XDG state beyond expected paths. | likely |

## 3. Confirmed gaps

- Auto-start behavior in init non-interactive mode defaults to true but lacks explicit user warning or --no-start documentation in help text
- Dirty-repo detection during init is silent by default (no warning unless --verbose); upgrade scripts may not alert user to uncommitted changes
- .cx/context.md/.cx/context.json are written once per project but never re-converged; user edits are preserved but drift from template is undetected
- No manifest tracking for .cx/ directory itself; oracle/doctor/intake state files can accumulate without pruning by sync/init

## 4. Unconfirmed concerns

- init --auto-start default may restart services on upgrade without explicit user opt-in signal
- Marker injection in AGENTS.md defers to sibling Beads Integration block but code does not verify Beads block exists before deferring (hasBeadsBlock detection at line 105)
- sync's two-phase staging uses relative path calculation (line 391) which could collide in parallel test runs if stagingDir not properly isolated per tier
- Doctor daemon state file (.cx/doctor.json) persisted by daemon, not managed by init/sync; stale state files not cleaned up by uninstall
- OpenCode migration of legacy .opencode/config.json to .opencode/opencode.json (line 1704-1706) renames rather than checks content equivalence

## 5. Registry / config / schema opportunities

- Auto-start services flag could be moved from init-unified.mjs hardcoded boolean to a registry entry (construct.config.json) or env var (CONSTRUCT_INIT_AUTO_START)
- Dirty-repo handling behavior (silent vs warn vs error) could be configurable via construct.config.json scope-specific setting rather than --verbose only
- .cx/ directory retention policy (what to preserve on upgrade, what to prune) could be expressed in schema rather than implicit skip-if-exists
- Service startup config could be unified across init and construct dev: both could read a services.json manifest instead of hardcoding which services to start

## 6. Tests needed

- Verify init auto-start does NOT trigger on explicit --no-start even in non-interactive mode
- Test init on dirty repo (uncommitted .cx/ changes) and confirm skip-if-missing behavior does not revert context files
- Verify uninstall with --keep-state preserves .cx/context.md and .cx/context.json but removes .cx/doctor.json, etc.
- End-to-end test: init, manual edit of .cx/context.md, re-run init, confirm file unchanged (no drift loss)

## 7. Docs needed

- Clarify init auto-start default in non-interactive mode and how --no-start interacts with --auto-start
- Document the marker-based dedup logic in AGENTS.md/CLAUDE.md injection and version+hash bump conditions
- Explain HOME/XDG isolation contract and why setup.mjs never writes to project .cx/config.env
- Guide on when uninstall --keep-state preserves .cx/ vs when manual cleanup may be needed after upgrade

## 8. Migration concerns

- Upgrade from pre-marker AGENTS.md (no version+hash block) to new marker-managed version: inject.mjs creates new block on first sync, but manual edits in old file are preserved outside marker boundaries
- Legacy .opencode/config.json files are renamed to .opencode/opencode.json during sync; if both exist, legacy is dropped (line 1706) — users relying on old path may not notice
- sync --global run twice (plain construct sync then construct sync --global per install.mjs line 575-576) both write to same .cx/sync.lock, may collide in parallel installs

## 9. Questions for Opus

- Is the auto-start default in non-interactive init intentional, or should it require explicit --auto-start flag on upgrades to avoid restarting user services?
- Should init detect and warn about drift in .cx/context.md after first initialization, or is user-manual-edit-without-re-sync the intended contract?
- Does the marker-dedup in AGENTS.md handle the case where a Beads Integration block is present but the shortHash differs (i.e., should one take precedence)?
- Is doctor.json state file cleanup (stopDoctor removes stale-state file at line 195-199) intentionally separate from uninstall, or should uninstall --scope=machine also clean daemon state?

## 10. Suggested bead updates (proposals only — Opus owns Beads)

_none reported_

