# Construct — Meta-System Instructions

This repo IS Construct. Changes here affect every session, every platform, every agent.

## Critical rules

- **Never run `construct sync` or `bash install.sh` mid-edit.** These regenerate all agent files and push to live configs. Only run after all edits are complete and reviewed.
- **Never edit `registry.json` without understanding the cascade.** Every change regenerates agents for OpenCode, Claude Code, Codex, and Copilot. Read sync-agents.mjs before touching it.
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

## After making changes

1. Test the specific hook or script in isolation
2. Run `construct doctor`
3. Run `construct sync` to regenerate platform files
4. Verify with `construct list`
