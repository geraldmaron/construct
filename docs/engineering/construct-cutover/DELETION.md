# Deletion inventory

| Candidate | Consumer | Decision | Why |
|---|---|---|---|
| Beads operating contract in AGENTS/CLAUDE | every session | remove | Native ledger is the writer |
| `npm run reconcile` / `scripts/reconcile-tracker.mjs` | citation lint / historical reader | retain until export freeze is enough for doc lint | No longer invoked from repo-gate or session contract |
| `.beads` hooks that re-export JSONL | git hooks | retain unstage-only | Prevents a stray export from landing; does not write |
| Retired dispatcher `work` plus `--run` | none in src | already gone | Gate matches that exact retired form |
| Dual tracker/markdown/db status | docs + beads + sqlite | remove dual write | Ledger owns active status |
| Official MCP SDK | hosts/mcp | retain custom JSON-RPC for now | Need a locked stable SDK release vs host support; recorded as remaining work |
| Archive of dead executable code | none | none created | Don't ship hidden runtime |

Every retained subsystem has an owner in ARCHITECTURE.md.
