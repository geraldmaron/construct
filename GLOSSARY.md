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
