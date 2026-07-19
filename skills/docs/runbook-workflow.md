---
name: docs-runbook-workflow
description: "Use when: creating operational procedures for services, alerts, or recurring operations."
inputs: [service, incident]
artifactType: runbook
verificationBar: "Every load-bearing claim cites a verifiable source; label inference confidence; satisfy template structure requirements."
---
# Runbook Workflow

Use when: creating operational procedures for services, alerts, or recurring operations.

## Steps

1. **cx-operations** identifies the need
2. **Write to `docs/operations/runbooks/{service}-{operation}.md`** using the template from `get_template("runbook")`: resolves `.construct/templates/docs/runbook.md` (override) then `templates/docs/runbook.md` (shipped)
3. **Link from the relevant alert** or monitoring dashboard
4. **cx-operations** adds to `.construct/context.md` if it's a critical path runbook

The steps above are the baseline, not the final roster. Authoring through `author_artifact` (type `runbook`) recruits additional participants from the request's content signals (ADR-0070), returned as `recruited` with a specialist, reason, role, and gate for each. Honor that set instead of treating this chain as fixed; `recruitment: "off"` or an explicit cx- id list overrides it.

## File naming
- `docs/operations/runbooks/telemetry-restart.md`
- `docs/operations/runbooks/db-migration.md`
- `docs/operations/runbooks/incident-response.md`

## Review cadence
- Runbooks should be tested (table-top or live) at least quarterly
- Update `Last updated` field after each use or review
## Release gate

Run `construct artifact validate <path> --type=<type>` before marking the artifact approved.
