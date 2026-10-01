# Deletion inventory

| Candidate | Consumer | Decision | Why |
|---|---|---|---|
| Beads operating contract in AGENTS/CLAUDE | every session | remove | Native ledger is the writer |
| `npm run reconcile` / `scripts/reconcile-tracker.mjs` / `scripts/tracker/` | citation lint no longer uses it | remove | Frozen `.beads/issues.jsonl` is enough for `lint-doc-bead-refs` |
| `.beads` hook sections that run `bd` | git hooks | remove | A commit from any worktree ran `bd export` against the main checkout's frozen `.beads/issues.jsonl`; the Construct gate and commit-message sections stay |
| Retired dispatcher `work` plus `--run` | none in src | already gone | Gate matches that exact retired form |
| Dual tracker/markdown/db status | docs + beads + sqlite | remove dual write | Ledger owns active status |
| Official MCP SDK | hosts/mcp stdio | repair | Locked `@modelcontextprotocol/server` 2.0.0 for framing; domain contracts stay in Construct |
| Archive of dead executable code | none | none created | Don't ship hidden runtime |

Every retained subsystem has an owner in ARCHITECTURE.md.
