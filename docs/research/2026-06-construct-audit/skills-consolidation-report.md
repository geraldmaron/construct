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

## Per-category investigation (option A, completed) — the result reverses the hypothesis

Classifying the 55 bound-orphans and **verifying each category against profiles, the
prompt-composer telemetry, and reference counts** collapses the prune list to ~1:

- **6 are composer-reachable** — loaded via `prompt-composer` despite no static binding
  (`roles/architect`, `roles/engineer`, `roles/engineer.ai`, …). The binding audit's false
  positives. **Keep.**
- **43 are conditional flavors of an existing specialist** — `roles/<specialist>.<flavor>`
  (`architect.data`, `qa.web-ui`, `security.appsec`, `product-manager.growth`, …). They load
  when that specialist runs in that flavor. **Keep.**
- **5 of the "truly unbound" are used by a profile** — `roles/operator{,.docs,.release,.sre}`
  is the `operator` role in `profiles/operations.json` (lines 8, 22), and `docs/strategy-workflow`
  has 2 references. The binding audit missed these because it checks only
  `specialists/registry.json`, not profile role sets. **Keep.**
- **1 unbound-but-valuable skill:** `docs/document-ingest-workflow` — no owner, no references,
  never loaded, **but the content is legitimate** (the PDF/Word/spreadsheet → searchable-markdown
  workflow, distinct from the sibling `evidence-ingest-workflow`). Not superseded. So it is a
  *binding gap* (it should be bound to a specialist or referenced), not dead weight.

**Conclusion: ZERO skills warrant deletion.** Of 150 skills, rigorous per-category verification
finds none that are genuinely dead — the "94% bloat" reading was a single-user-usage artifact, and
the binding-orphan signal is dominated by false positives — profile roles, composer reachability,
and conditional flavors account for 54 of the 55 [source: the per-category breakdown above]. The
corpus is appropriately sized; the real defect is the audit, not the corpus.

## Recommended follow-ups (filed, not blocking)

1. **Improve `lib/audit-skills.mjs`** so it counts profile role bindings and composer
   reachability, not only `specialists/registry.json` — it currently over-reports orphans by
   ~54/55 here (bead construct-ksfa). This is the real fix the audit needs.
2. **Bind `docs/document-ingest-workflow`** to a specialist (it pairs with the docling ingest
   path) instead of leaving it unreachable — a binding gap, not a deletion.

No skills are removed.
