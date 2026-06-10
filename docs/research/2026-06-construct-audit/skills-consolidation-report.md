# Skills Consolidation Report — for approval (bead construct-smil)

Date: 2026-06-10 · Gate: **nothing is deleted until the maintainer approves a list.**
Reproduce: the rollup script in this section runs against `~/.cx/skill-calls.jsonl` +
`lib/audit-skills.mjs` bindings.

## The numbers

- **150** skill files on disk.
- **6,065** skill-load telemetry events (`~/.cx/skill-calls.jsonl`).
- **9** skills ever loaded; only **4** substantively:
  `roles/engineer.ai` (2027), `roles/engineer.platform` (1662), `roles/engineer` (1198),
  `roles/architect.ai-systems` (1173). The other 5 have a single load each.
- **141** never loaded in this telemetry.
- **55** bound-orphans — declared by *no* specialist in `specialists/registry.json`.
- **49** are both never-loaded **and** bound-orphans.

## The caveat that gates this (why "never loaded" ≠ "delete")

The telemetry is **single-user session usage**, not skill value. A role skill only loads
when its specialist runs, so `roles/data-analyst.*` reads as "never loaded" simply because
`cx-data-analyst` was not invoked in these sessions — not because the skill is useless.
Another user, or a future session, would load it. **Usage telemetry cannot justify deletion.**

The defensible, value-neutral signal is the **binding** one: a skill that *no specialist
declares* (bound-orphan) is unreachable through the agent path regardless of who runs what.
Even there, a few may be loaded conditionally by the prompt-composer (flavor resolution), so
the list needs a category-level look, not a blind `rm`.

## Recommended action (for your call)

1. **Keep, no question:** the 4 hot `roles/engineer.*` / `roles/architect.ai-systems` skills
   and everything an active specialist declares.
2. **Primary consolidation target — the 55 bound-orphans.** These are the real question: are
   they (a) dead role flavors from retired specialists, (b) skills that *should* be bound to a
   specialist but were never wired, or (c) composer-resolved flavors that are reachable without
   a static binding? This needs a per-category decision, not a usage cutoff. Sample:
   `roles/architect.{data,enterprise,integration,platform}`, `roles/data-analyst.*`,
   `roles/data-engineer.*`, `roles/debugger`, `docs/document-ingest-workflow`,
   `docs/strategy-workflow`.
3. **Do NOT delete on telemetry alone.** The 92 "declared-by-an-owner-but-never-loaded" skills
   are most likely fine — they load on demand when their specialist runs.

## Decision needed

Which do you want?
- **A — Investigate the 55 bound-orphans by category** (recommended): I produce a per-category
  classification (dead vs should-bind vs composer-reachable), and we delete/rebind only the
  confirmed-dead ones.
- **B — Adopt OpenHands-style trigger-scoped microagents:** restructure skills so the always-on
  surface is tiny and the rest load by keyword trigger — a larger architecture change.
- **C — Defer:** the hot core works; consolidation is not urgent enough to risk over-pruning a
  multi-tenant skill corpus on one user's telemetry.

No skills are removed under any option until you approve the specific list.
