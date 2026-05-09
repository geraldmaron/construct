<!--
skills/docs/runbook-workflow.md — Runbook Workflow — Use when: creating operational procedures for services, alerts, or recurring ope

Use when: creating operational procedures for services, alerts, or recurring operations. ## Steps
-->
# Runbook Workflow

Use when: creating operational procedures for services, alerts, or recurring operations.

## Steps

1. **cx-sre** or **cx-release-manager** identifies the need
2. **Write to `docs/runbooks/{service}-{operation}.md`** using the template from `get_template("runbook")` — resolves `.cx/templates/docs/runbook.md` (override) then `templates/docs/runbook.md` (shipped)
3. **Link from the relevant alert** or monitoring dashboard
4. **cx-docs-keeper** adds to `.cx/context.md` if it's a critical path runbook

## File naming
- `docs/runbooks/langfuse-restart.md`
- `docs/runbooks/db-migration.md`
- `docs/runbooks/incident-response.md`

## Review cadence
- Runbooks should be tested (table-top or live) at least quarterly
- Update `Last updated` field after each use or review
