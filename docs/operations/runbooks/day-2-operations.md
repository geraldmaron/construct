---
cx_doc_id: 019dc800-0000-0000-0000-day2operations
created_at: "2026-04-30T00:00:00.000Z"
updated_at: "2026-04-30T00:00:00.000Z"
generator: construct/docs-session
body_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000"
---
# Runbook: Day-2 Operations

- **Service**: Construct CLI and daemon
- **Owner**: operator
- **Last tested**: 2026-04-30
- **Severity**: SEV-3 (routine maintenance)

Recurring tasks to keep Construct healthy, docs current, and costs under control.
Run these on a cadence that fits your team: weekly is a reasonable default.

---

## 1. Verify system health

```bash
construct doctor
```

Checks: install integrity, config env, service connectivity (memory, dashboard), MCP server
status, and host adapter files. Exits non-zero on any failure.

If `doctor` reports a failing check:
- Missing config keys → edit `~/.config/construct/config.env`
- Services not running → `construct dev`
- Host adapter stale → `construct sync`

---

## 2. Check docs are current

```bash
construct docs:update --check
```

Exits non-zero if any AUTO-managed region (commands table, agents table, hooks table,
core-docs contract) is out of date. If it fails:

```bash
construct docs:update
```

Then commit the changed files.

### Check how-to coverage

```bash
construct docs:check
```

Reports CLI commands with no linked how-to guide. Use the output to identify documentation gaps.

---

## 3. Review comment policy

```bash
construct lint:comments
```

Flags files missing stub headers or containing narrative comments that violate the comment policy
in `rules/common/comments.md`. To auto-insert stub headers:

```bash
construct lint:comments --fix
```

---

## 4. Verify artifact stamps

```bash
construct doc verify docs/
```

Checks every markdown file under `docs/` for a valid auditability stamp. Fails on missing or
corrupted stamps. Useful after bulk edits or merges.

---

## 5. Review costs

```bash
construct status --json | jq .sessionUsage
```

Check token usage, cache read tokens, and total estimated spend. If cache read rate is low, check that prompt caching is enabled for the active provider.

```bash
construct efficiency
```

Shows repeated file reads and large reads for the current session. If `Status: degraded`,
run `construct distill` with a focused query and compact context before continuing.

---

## 6. Review agent quality (requires telemetry backend)

```bash
construct review --days=7
```

Generates a performance report under `~/.construct/performance-reviews/`. Check for agents with quality score < 0.7.

If any agent is below threshold:

```bash
construct optimize <agent-name>
construct optimize <agent-name> --apply
```

The bare command is a dry-run that prints the diagnosis and proposed patch; review it, then
`--apply` writes the patch to the agent's role skill file (`skills/roles/<role>.md`) and
auto-runs `construct sync`. Revert with `construct optimize <agent-name> --rollback` if the
agent's scores drop.

---

## 7. Sync eval datasets (requires telemetry backend)

```bash
construct eval-datasets
```

Pulls scored traces into `.construct/evals/` for regression testing. Run after a `review` cycle to
keep the eval corpus current.

---

## 8. Inspect the mutation trail

```bash
construct audit trail --since=7d
```

Shows all mutations in the last 7 days. Add `--verify` to confirm file hashes match their
audit stamps. Add `--json` for machine-readable output.

---

## References

- `docs/guides/concepts/architecture.mdx`: system overview and runtime boundaries
- `docs/guides/cookbook/observability-and-cost.md`: detail on review/optimize/cost/efficiency
- `docs/guides/cookbook/manage-providers.md`: provider and model tier management
- `CLAUDE.md` § "Documentation is mandatory": docs update step before commit
