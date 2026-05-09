<!--
skills/docs/backlog-proposal-workflow.md — Approval-gated issue tracker proposals.
-->
# Backlog Proposal Workflow

Use when: product evidence should create or update Jira, Linear, GitHub Issues, or another tracker.

## Steps

1. Load source evidence, evidence brief, PRD, or signal brief.
2. Search existing tracker context if an MCP is configured; otherwise search local docs and product-intel artifacts.
3. Create `.cx/product-intel/backlog-proposals/{date}-{slug}.md` with `get_template("backlog-proposal")`.
4. Include duplicate/conflict analysis and exact proposed writes.
5. Return `NEEDS_MAIN_INPUT` for approval before any external write.
6. After approval, apply changes and update the proposal's application log.

## Rules

Never write externally from weak evidence without making the risk explicit. Never create duplicate issues when an existing issue can be updated.
