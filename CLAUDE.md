# Construct — Meta-System Instructions

This repo IS Construct. Changes here affect every session, every platform, every agent.

## Critical rules

- **Never fabricate.** Every load-bearing claim in any artifact (PRD, ADR, RFC, brief, knowledge note, handoff, review, summary, classification rationale) must trace to a source the reader can re-verify. Don't invent quotes, ticket IDs, customer names, percentages, dates, or file paths. When a fact isn't in the source, write `unknown` or `[unverified]`. See `rules/common/no-fabrication.md`. Enforced by `lib/comment-lint.mjs` on artifact paths and by `specialists/org/contracts/` postconditions on specialist handoffs.
- **Confirm the working branch every session.** Session-start surfaces `## Working branch: <name>` at the top of the injected context. Restate it before any mutating operation.
- **Never commit, push, or merge without asking first.** Before `git commit`, `git push`, or `gh pr merge`: state the branch, state what's about to happen, ask for confirmation, wait for yes. A yes in chat is the approval — no separate command or marker. See `rules/common/commit-approval.md`.
- **Never edit running hook files** (`lib/hooks/*.mjs`) without testing them in isolation first. A broken hook blocks all tool use.
- **Hooks fire unconditionally. No skip env vars on quality gates.** A skip env var is an admission that the gate is wrong-shaped, the policy is over-scoped, or the team will route around it. If a check fires wrong, repair the check — do not re-introduce `CONSTRUCT_SKIP_*` / `CONSTRUCT_ALLOW_*` / `CONSTRUCT_QUIET_*`. Notice-only signals (reminders, advisory nudges) auto-suppress in non-interactive contexts (`CI=true`, `NODE_ENV=test`, `!process.stderr.isTTY`); the wrong-context detection is the right mechanism. Enforced by `tests/hooks/no-skip-vars.test.mjs`.
- **Never commit directly to main.** Branch, test, then merge.
- **Run `construct doctor` after any structural change** to verify the system is healthy.
- **Multi-component features require a functional test.** If a change touches more than one of: hook + observation, profile + classifier, CLI + durable state, then a test must live in `tests/functional/` that spawns the real binary or imports the real module in an isolated tmpdir and asserts on durable artifacts. CI is a backstop, not a primary gate. See `tests/functional/README.md`.
- **Profiles are research artifacts, not JSON exercises.** Any new profile that lands in `profiles/` must go through the lifecycle in `docs/guides/concepts/scope-lifecycle.md`: discover → frame → architect → validate → promote. The cx-ux-researcher, cx-product-manager, cx-architect, and cx-evaluator specialists each own a phase. `construct scope create <id>` scaffolds the draft and the requirements brief; drop-in JSON is allowed for experiments but not for the curated catalog.

## Protected files — edit with extra care

| File | Why |
|---|---|
| `specialists/org` | Source of truth for all agents on all platforms |
| `lib/setup.mjs` / `bin/construct-postinstall.mjs` | Install/setup path — runs on user machines, a bug affects all installs |
| `lib/hooks/*.mjs` | Run in every Claude Code session |
| `claude/settings.template.json` | Controls all Claude Code hook config |

## Safe to edit freely

- `personas/*.md` — persona prompts (run `construct sync` after)
- `skills/**` — domain knowledge files (includes `skills/roles/` — role anti-patterns, inlined at sync time)
- `templates/docs/**` — shipped doc templates; users override via `.cx/templates/docs/` (see [templates/docs/README.md](templates/docs/README.md))
- `rules/**` — coding standards
- `lib/server/**` — dashboard only

## Documentation is mandatory

**Always update docs before committing, unless explicitly instructed otherwise.** This is non-negotiable.

Before any commit, ensure the following are current:
- `CHANGELOG.md` — new entry describing what changed and why
- `docs/guides/concepts/architecture.md` — if runtime shape, contracts, or boundaries changed
- `docs/README.md` — if core docs set or maintenance expectations changed
- `.cx/context.md` / `.cx/context.json` — if active work, decisions, or architecture assumptions changed

Skipping documentation requires an explicit user instruction to skip. "Just commit" or "push it" does NOT waive this requirement — docs still get updated.

## Comment convention

Two forms only. All other comments are deleted.

**File header** — one `/** */` block at the top of every file describing purpose, key behaviors, and non-obvious constraints.

**Section context block** — a comment block immediately before a logical section, followed by a blank line, then the code:

```js
// BM25 is unbounded; normalize against its own max so it merges fairly with cosine [0,1].

const bm25Max = bm25Scored[0]?.score || 1;
```

Never allowed: inline trailing comments (`x = 1; // note`), mid-function narration, between-group labels, narrative voice (`We/This/Now/It`), point-in-time notes (`removed/previously`), noise sentinels (`ok/skip/best effort`).

This applies to every file construct touches and to all agents working in this project.

## After making changes

1. Test the specific hook or script in isolation
2. Run `construct doctor`
3. Run `construct sync` to regenerate platform files
4. Verify with `construct list`
5. Update documentation (see above)
6. Run the full gate before commit: see `CONTRIBUTING.md` § "Before opening a PR" for the eight-check list. The release pipeline (`docs/operations/maintenance/release-and-deploy.md`) runs the same checks.


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands. Hygiene contract — claim/close/supersede rules, pre- and post-work checks, evidence requirements — lives in [rules/common/beads-hygiene.md](rules/common/beads-hygiene.md) and applies to every agent on every platform.

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
