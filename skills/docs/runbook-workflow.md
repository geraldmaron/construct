---
name: docs-runbook-workflow
description: "Use when: creating operational procedures for services, alerts, or recurring operations."
inputs: [service, incident]
artifactType: runbook
verificationBar: "Alert→Diagnostic(D-*)→Remediation(R-*)→Rollback(RB-* with last tested)→Escalation→Adversarial challenge; operator-runnable steps only."
---
# Runbook Workflow

Use when: creating operational procedures for services, alerts, or recurring operations.

## Native spine (blocking)

Alert trigger → Symptoms → Impact → Severity and response → Diagnostic steps → Remediation → Rollback → Escalation → Post-incident → Adversarial challenge → References.

```text
Diagnostic D-*  →  expected signal  →  next action
Remediation R-*  →  expected output  →  failure branch
Rollback RB-*  →  last tested date (or [unverified])
```

- `construct artifact validate --type=runbook` runs `lintRunbookDeliveryDepth`.

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
- Update `Last tested` field after each use or review
## Release gate

Run `construct artifact validate <path> --type=<type>` before marking the artifact approved.

## Shared authorship contract

Before drafting or reviewing, call `get_skill("docs/artifact-authorship")` for framing, template population, storytelling, adversarial review, anti-fabrication, and cross-persona triggers. Persona overlays under `skills/perspectives/` add failure modes; they do not waive that contract.
