# Construct — Meta-System Instructions

This repo IS Construct. Changes here affect every session, every platform, every agent.

## Critical rules

- **Confirm the working branch every session.** Session-start surfaces `## Working branch: <name>` at the top of the injected context. Restate it before any mutating operation.
- **Never commit, push, or merge without asking first.** Before `git commit`, `git push`, or `gh pr merge`: state the branch, state what's about to happen, ask for confirmation, wait for yes. A yes in chat is the approval — no separate command or marker. See `rules/common/commit-approval.md`.
- **Never edit running hook files** (`lib/hooks/*.mjs`) without testing them in isolation first. A broken hook blocks all tool use.
- **Never commit directly to main.** Branch, test, then merge.
- **Run `construct doctor` after any structural change** to verify the system is healthy.

## Protected files — edit with extra care

| File | Why |
|---|---|
| `agents/registry.json` | Source of truth for all agents on all platforms |
| `install.sh` | Runs on user machines — a bug affects all installs |
| `lib/hooks/*.mjs` | Run in every Claude Code session |
| `claude/settings.template.json` | Controls all Claude Code hook config |

## Safe to edit freely

- `personas/*.md` — persona prompts (run `construct sync` after)
- `skills/**` — domain knowledge files (includes `skills/roles/` — role anti-patterns, inlined at sync time)
- `templates/docs/**` — shipped doc templates; users override via `.cx/templates/docs/` (see [docs/templates/README.md](docs/templates/README.md))
- `rules/**` — coding standards
- `lib/server/**` — dashboard only

## Documentation is mandatory

**Always update docs before committing, unless explicitly instructed otherwise.** This is non-negotiable.

Before any commit, ensure the following are current:
- `CHANGELOG.md` — new entry describing what changed and why
- `docs/architecture.md` — if runtime shape, contracts, or boundaries changed
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
