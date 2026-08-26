# Glossary

The natural-language naming binding for every surface — schemas, CLI, docs. `scripts/lint-glossary-parity.mjs` enforces that these are the only terms used; a v2-era synonym (left column context below) surfacing anywhere is a drift signal.

| Term (use this) | Retired v2 synonym | Meaning |
|---|---|---|
| role | persona | A framing and risk posture over the shared playbook, plus a domain corpus. Attribution and obligation, not a voice to write in. |
| lesson | ring | An append-only, cited unit of learning; supersedes but never overwrites. |
| playbook | trunk | The shared operational method every role draws on. |
| brief | contract | A declaration of what a task needs: inputs, tool capabilities, postconditions. |
| dispatcher | router | Resolves a brief's requirements against available tools and roles. |
| host | harness | The agent runtime a role actually executes on. Four adapters ship: OpenCode, Claude Code, the Codex CLI, and the Cursor CLI. Only OpenCode and Claude Code carry `outward-write`; Codex and Cursor dispatch read-only. |
| deliverable | artifact | The finished, traceable output of a run. |
| work log | accountability ledger | The append-only record of what was done, by whom, under what role. |
| decision inbox | — | The short list of calls that are genuinely the user's to make. |
| model capability floor | — | The weakest model tier a brief's work may run on: `any`, `capable`, or `frontier`. Ordinal and family-agnostic — never a vendor model name. Running below it degrades loudly and is recorded; it does not refuse. |
| projection | — | The spine made present inside a user's agent host through one protocol surface (MCP). The host that is already running names concerns via `record_outcome` (namings required on serve), claims queued work, and submits a draft (`claim_task` / `submit_work`); adapters remain the spawn path when no session is wrapping the command. Neither surface can advance completion state. |
| namer | — | Construct's namer seam: a host model consulted to name the domains an outcome implicates. Its output passes the same admission gate as every other inference; it proposes, never certifies. In-session `record_outcome` namings are this session, not this seam. |
| skill | — | A portable, self-contained unit of method an agent host loads on demand, carrying its verification gates in its own body and stating its enforcement tier plainly. Severable by definition: the kernel is never required for a skill to work. |
| resource census | — | What this machine actually has to dispatch through: every host, whether it was found, its capabilities, the tier of the model it would run, and what a run there costs. One survey feeds both `construct doctor` and the choice `construct work` makes when no host was named. |
| cost class | — | What a call on a resource costs, ordered cheapest first: `local` (served here, free to re-run), `subscription` (a login already pays for it), `metered` (billed per call), `unknown` (never measured). Unknown is ordered last, not in the middle: silence about spend is not evidence of cheapness. |
| skill reach | — | Where a dispatched role can get at a shipped skill: `installed`, a copy in the machine's agent skills directory, which is what a host loads and therefore the copy whose text governs; or `checkout`, a copy only this repository holds, reached by reading the file. A run names every reachable skill with the skill's own description, and says plainly when none is reachable. |

*(Footnote, 2026-08-20 — the word "persona" carries three senses on the record, and only one is retired.)* Retired: the v2 synonym for `role` in the table above — the premise that a persona differentiates what a model finds was tested and withdrawn (RESEARCH-DECISIONS.md §15), and the word never names a role on any surface. Alive, different sense: the professional **reader** whose acceptance a deliverable must earn — `docs/internal/persona-acceptance-rubrics.md` uses it this way, the filename is load-bearing for `scripts/lint-reader-rubric-parity.mjs`, and inside `src/` that concept is written `reader`. Alive, different sense again: external brand framing — "Construct is the face of the skills" (the 2026-08-20 decision) may describe that face as a persona to an outside audience, which claims nothing about capability. A fourth appearance, `personal data` in the privacy domain, is not the word.

*(Footnote, 2026-08-20, second entry.)* The 2026-08-15 staff-member directive (construct-1zx1) — Gerald's own stakeholder language — speaks of the persona Construct steps into for a given assignment. That usage is the retired sense above, not a fourth one: the directive's "persona" and the table's `role` name the same thing, and this line is the record of the binding rather than a rename of either.
