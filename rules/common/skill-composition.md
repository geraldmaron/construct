<!--
rules/common/skill-composition.md — how specialist prompts compose with skill files.

Defines the default boundary between what lives in the agent's base prompt and
what is fetched via `get_skill` at runtime. Aims to keep prompts lean while
keeping domain knowledge reliably available when needed.
-->
# Skill Composition Policy

Specialist agent prompts are lean on purpose. Domain depth lives in skill files and is pulled in on demand, not pre-inlined.

## Default: on-demand skill loading

Every specialist prompt carries a marker:

```
**Role guidance**: call `get_skill("roles/NAME")` before drafting.
```

When the agent begins substantive work in its domain, it calls `get_skill("roles/NAME")` via the construct-mcp server. The skill body is returned for that turn only — no permanent prompt budget is consumed.

All hosts Construct supports (Claude Code, OpenCode, Codex, Copilot) have `get_skill` available through the construct-mcp server, so the runtime call is reliable.

## Why on-demand is the default

Inlining every role skill at sync time used to consume ~1000–2000 words of prompt budget per specialist, regardless of whether the skill content was relevant to the current task. That budget is fixed — it reduces the window available for actual context.

On-demand loading means:

- Quick tasks that don't need the full role body never pay the word cost
- The agent can load only the flavor overlay it actually needs
- Prompt caps become a real soft target, not a constant overage
- Skill content can be updated without re-syncing every agent prompt

## Opt-in preload: `preloadRoleGuidance: true`

Set `preloadRoleGuidance: true` on a registry entry only when:

- The agent ships to hosts that do not expose `get_skill` reliably
- The role content is so load-bearing that every single turn needs it
- The agent's model is weak at tool-calling discipline and skips the `get_skill` call in practice

This should be rare. If you find yourself preloading most agents, revisit the reasoning — the default exists because the cost is real.

## Skill array vs. role guidance

Two different mechanisms for two different purposes:

- **Registry `skills: [...]` array** — declarative metadata listing which skills the agent is *entitled* to call. Not inlined into the prompt. Used by `list_skills`, routing heuristics, and audit tooling. Add skills here liberally.
- **Role guidance directive** — the single `**Role guidance**: call get_skill("roles/NAME")` line in the prompt. Points the agent at its role file and (by default) tells it to load on demand. Exactly one per agent.

## Contributor guidance

When adding or editing a specialist:

1. Keep the base prompt short — role, perspective, productive tension, handoff contract. Under 400 words is normal.
2. Put domain depth into `skills/roles/NAME.md` and optional flavor overlays like `skills/roles/NAME.FLAVOR.md`.
3. Leave the role-guidance directive in place. Do not manually inline role content into the prompt body.
4. Only add `preloadRoleGuidance: true` with a written reason in the registry description.

## Anti-patterns

Do not:

- Paste role-skill content directly into the prompt body "to be safe"
- Add `preloadRoleGuidance: true` to push a prompt under the cap without fixing the underlying bloat
- Split a role skill into many tiny files to dodge the cap — keep the cohesive unit, load it on demand instead
