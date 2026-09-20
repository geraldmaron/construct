# Verification report

## Gates

| Check | Command | Result | Observed |
|---|---|---|---|
| Lint | `npm run lint` | passed | Node v24.19.0 |
| Types | `npm run typecheck` | passed | |
| Tests | `npm test` | passed | 341 tests |
| Smoke | `npm run smoke` | passed | Packaged init, `work add/list/ready`, MCP loop, doctor format 3 |
| Live-host evals | `npm run evals:live` | not run | No new paid API use |

## Migration

| Step | Result |
|---|---|
| Source identity | `bd` 1.0.3 embedded Dolt, mode direct, 566 issues, 6 open. No other `bd` writer observed. |
| Recovery material | `.construct/recovery/2026-09-20/` (gitignored): live JSONL export, last Dolt backup copy, pre-cutover sqlite, checksum inventory, native work export (567 items) |
| Isolated restore | Temp repo `bd init --skip-agents --skip-hooks`; imported 566 issues + 9 memories; open set matched (6). Second `bd import` no-oped (empty Dolt commit). |
| Dry-run native import | 566 imported, 0 malformed, 0 duplicates, 0 orphans; 560 historical, 6 open |
| Project import | Same counts on write. Rerun skipped 566, malformed 0. Native writer is the ledger. |
| Dual-write disabled | AGENTS/CLAUDE native contract; `.claude/settings.json` no longer runs `bd prime`; repo-gate no longer runs tracker reconcile |
| Dolt `bd backup sync` | Not run. Auto backup already existed; syncing can follow a git remote. Coverage of history is the copied `.beads/backup` plus the readonly export, not a fresh `bd backup sync` in this session. |

## Honesty

A14 held-out host comparisons were not run. Official MCP SDK is not yet
adopted (custom JSON-RPC retained). The frozen `.beads` tree remains for
recovery and citation lint; it is not an active writer.

Cutover files are staged on `staging` (72 paths, excluding unrelated
`.construct/*.json` and gitignored recovery/state). Local commit is blocked
on 1Password SSH signing from this Cursor session (`op-ssh-sign`: agent
returned an error). Next command after signing is available:

```
git commit -m "$(cat <<'EOF'
Native work owns active status; discovery admits evidence with provenance

Replace the external tracker as the live writer with a project ledger, connect source admission through verification, and freeze Beads as recovery input.

EOF
)"
git push origin staging
```

Restore `.beads/issues.jsonl` if the Beads hook rewrites it during the
attempt. Do not add `.construct/`. Do not merge main, tag, or publish.
