# Glossary

The natural-language naming binding for every surface — schemas, CLI, docs. `scripts/lint-glossary-parity.mjs` enforces that these are the only terms used; a v2-era synonym (left column context below) surfacing anywhere is a drift signal.

| Term (use this) | Retired v2 synonym | Meaning |
|---|---|---|
| role | persona | A framing and risk posture over the shared playbook, plus a domain corpus. |
| lesson | ring | An append-only, cited unit of learning; supersedes but never overwrites. |
| playbook | trunk | The shared operational method every role draws on. |
| brief | contract | A declaration of what a task needs: inputs, tool capabilities, postconditions. |
| dispatcher | router | Resolves a brief's requirements against available tools and roles. |
| host | harness | The agent runtime a role actually executes on (OpenCode, Claude Agent SDK, Claude Code). |
| deliverable | artifact | The finished, traceable output of a run. |
| work log | accountability ledger | The append-only record of what was done, by whom, under what role. |
| decision inbox | — | The short list of calls that are genuinely the user's to make. |
| model capability floor | — | The weakest model tier a brief's work may run on: `any`, `capable`, or `frontier`. Ordinal and family-agnostic — never a vendor model name. Running below it degrades loudly and is recorded; it does not refuse. |
| projection | — | The spine made present inside a user's agent host through one protocol surface (MCP). Presence only: adapters execute work, the projection exposes the loop, and neither can advance completion state. |
| namer | — | Whatever names the domains an outcome implicates when consulted — a host model behind the kernel's namer seam. Its output passes the same admission gate as every other inference; it proposes, never certifies. |
| skill | — | A portable, self-contained unit of method an agent host loads on demand, carrying its verification gates in its own body and stating its enforcement tier plainly. Severable by definition: the kernel is never required for a skill to work. |

*(Footnote, 2026-08-20 — the word "persona" carries three senses on the record, and only one is retired.)* Retired: the v2 synonym for `role` in the table above — the premise that a persona differentiates what a model finds was tested and withdrawn (RESEARCH-DECISIONS.md §15), and the word never names a role on any surface. Alive, different sense: the professional **reader** whose acceptance a deliverable must earn — `docs/persona-acceptance-rubrics.md` uses it this way, the filename is load-bearing for `scripts/lint-reader-rubric-parity.mjs`, and inside `src/` that concept is written `reader`. Alive, different sense again: external brand framing — "Construct is the face of the skills" (the 2026-08-20 decision) may describe that face as a persona to an outside audience, which claims nothing about capability. A fourth appearance, `personal data` in the privacy domain, is not the word.

*(Footnote, 2026-08-20, second entry.)* The 2026-08-15 staff-member directive (construct-1zx1) — Gerald's own stakeholder language — speaks of the persona Construct steps into for a given assignment. That usage is the retired sense above, not a fourth one: the directive's "persona" and the table's `role` name the same thing, and this line is the record of the binding rather than a rename of either.
