# Construct Teams Model

> **Problem:** The original profile system aggregated roles by department but lacked explicit accountability, decision rights, and escalation paths. This left teams ambiguous about what they could decide and where to escalate when they hit a boundary.
>
> **Solution:** Teams are the primary organizational unit. Each team has an explicit owner, defined decision rights, forbidden decisions, and escalation paths.

## Team Structure

A team is defined by:

- **id**: Unique identifier (e.g., `product-group`, `engineering-group`)
- **name**: Human-readable name (e.g., "Product Group", "Engineering Group")
- **owner**: The role that holds primary accountability (e.g., `product-manager`)
- **roles**: The role ids that constitute the team
- **decisionRights**: Decisions this team is authorized to make
- **forbiddenDecisions**: Decisions this team explicitly cannot make
- **escalationPath**: The chain for escalating unresolved decisions
- **charter**: One-paragraph mission statement describing what the team owns and doesn't own
- **contact**: How to reach the team (Slack, email, owner contact)

## The Six Core Teams

### Product Group

**Owner**: Product Manager  
**Roles**: product-manager, ux-researcher, designer, researcher, accessibility

**Decision Rights**: intake-triage, design-approval, scope-change, evidence-requirement  
**Forbidden Decisions**: deployment, security-override, infra-change

**Escalation**: product-manager → rd-lead → orchestrator

**Charter**: Translate user reality into shippable change. Owns problem framing, requirements, evidence gathering, design decisions, and acceptance criteria. Does not own implementation choices, deployment decisions, or security policy. Escalates scope conflicts to R&D leadership.

---

### Engineering Group

**Owner**: Architect  
**Roles**: architect, engineer, debugger, ai-engineer, data-engineer, platform-engineer

**Decision Rights**: architecture, technology-selection, implementation-approach, performance-optimization  
**Forbidden Decisions**: product-scope, user-research, deployment-timing

**Escalation**: architect → rd-lead → orchestrator

**Charter**: Design, build, and harden the system. Owns architecture decisions, technology choices, code quality, debugging, AI integration, and the platform underneath. Does not own product framing, user research direction, or release timing. Escalates tech-debt conflicts to R&D leadership.

---

### Quality Group

**Owner**: Reviewer  
**Roles**: reviewer, qa, test-automation, evaluator, trace-reviewer, devil-advocate

**Decision Rights**: quality-gate-approval, test-strategy, evaluation-design, release-readiness  
**Forbidden Decisions**: scope-change, deployment-timing, architecture

**Escalation**: reviewer → architect → rd-lead

**Charter**: Verify the system does what it claims and surface what is broken. Owns review, testing, evaluation, trace analysis, and devil's-advocate framing. Does not own implementation or product decisions. Escalates quality vs. schedule conflicts to architecture/R&D.

---

### Governance Group

**Owner**: Security  
**Roles**: security, legal-compliance

**Decision Rights**: security-approval, compliance-review, risk-assessment, policy-definition  
**Forbidden Decisions**: product-scope, implementation-approach, deployment-readiness

**Escalation**: security → architect → orchestrator

**Charter**: Keep the system safe to operate and inside its legal envelope. Owns security review, compliance verification, risk assessment, and the audit trail. Does not own implementation or product decisions but can block deployments that violate policy. Escalates policy conflicts to orchestrator.

---

### Operations Group

**Owner**: SRE  
**Roles**: release-manager, sre, operations, docs-keeper

**Decision Rights**: deployment, rollback, incident-response, runbook-approval, ops-procedure  
**Forbidden Decisions**: architecture, product-scope, security-policy

**Escalation**: sre → architect → orchestrator

**Charter**: Keep the system running and shipping. Owns release management, SRE response, ops runbooks, documentation upkeep, and deployment execution. Does not own architecture or product decisions. Escalates reliability vs. change-rate conflicts to architecture/leadership.

---

### Strategy Group

**Owner**: R&D Lead  
**Roles**: rd-lead, business-strategist, data-analyst, explorer, orchestrator

**Decision Rights**: direction-setting, strategic-prioritization, measurement-design, research-scope, cross-team-orchestration  
**Forbidden Decisions**: implementation-details, user-research-methods, ops-procedures

**Escalation**: rd-lead → orchestrator

**Charter**: Hold the long view: what to build next, what to measure, what to retire. Owns R&D direction, strategic prioritization, measurement design, cross-team orchestration, and exploration. Does not own implementation or day-to-day operations. Arbitrates escalations from other groups.

---

## Decision Matrix

When a decision needs to be made, the relevant team has authority, **provided no other team holds veto rights**.

| Decision | Owner Team | May Veto |
|----------|-----------|----------|
| intake-triage | Product Group | Strategy Group |
| design-approval | Product Group | Engineering Group |
| scope-change | Product Group | Engineering Group, Operations Group |
| architecture | Engineering Group | Governance Group, Quality Group |
| security-approval | Governance Group | None (can block independently) |
| deployment | Operations Group | (requires: quality + security approval) |
| quality-gate-approval | Quality Group | None |
| rollback | Operations Group | None |
| incident-response | Operations Group | None |
| strategic-prioritization | Strategy Group | None |

## Team Escalation in Action

### Scenario: Product wants scope change, but Engineering says it's infeasible

1. **Product Group** proposes scope change (within their decision rights)
2. **Engineering Group** disagrees or flags technical blocker (may veto)
3. **Escalation**: Product owner escalates to rd-lead
4. **R&D Lead** (Strategy Group owner) arbitrates and makes final call

### Scenario: Someone tries to make a forbidden decision

1. **Product Group** attempts deployment decision (forbidden for them)
2. **Gateway** records forbidden-decision event
3. **Escalation path** is invoked automatically: product-manager → rd-lead → orchestrator
4. The decision does not proceed until proper authority approves

## Implementation: Headhunt Integration

When using `construct headhunt`, the team-first UX works like this:

```bash
# OLD (role-only):
construct headhunt architecture --for="Design API rate limiting"
→ Recommends: cx-architect, cx-engineer

# NEW (team-first):
construct headhunt architecture --for="Design API rate limiting"
→ Recommends: engineering-group (team) with roles cx-architect, cx-engineer
→ Prompt includes team charter, decision rights, escalation path
```

The overlay metadata now includes:
- `teamFocus`: Which team this work primarily involves
- `recommendedTeam`: Specific team id to engage
- `escalationPath`: Where to escalate if the team hits a boundary

## Profiles and Teams

Each curated profile defines a full set of teams for its operating context:

- **rnd** (R&D): All six core teams + no breaking changes to solo mode
- **operations** (Request/triage/resolve): Three teams (triage, delivery, reliability)
- **research** (Question/gather/analyze): Three teams (discovery, analysis, delivery)
- **creative** (Make content): Four teams (strategy, production, measurement, governance)

Teams in each profile mirror the department structure but add explicit decision boundaries and escalation.

## File Structure

- `specialists/teams-registry.json` — Central registry of team definitions (for reference/audit)
- `profiles/*.json` — Each profile lists its teams in the `teams[]` array
- `schemas/team.schema.json` — JSON schema for team validation
- `lib/roles/gateway.mjs` — Team escalation lookup functions:
  - `findTeamByRoleOwner(roleId, registry)` — Find team by owner
  - `getTeamEscalationPath(teamId, registry)` — Get escalation chain
  - `canTeamMakeDecision(teamId, decisionId, registry)` — Check authorization
  - `recordTeamDecision(decisionId, teamId, outcome, context)` — Audit trail
  - `recordForbiddenDecision(decisionId, teamId, reason, context)` — Block attempts

## Backward Compatibility

The original `departments[]` structure is retained in all profiles for backward compatibility. Teams are additive; existing code that reads departments continues to work unchanged. New code should prefer `teams[]`.

## Next Steps

1. **Staffing recommendations** now surface teams first, then individual roles
2. **Policy gates** (intake approval, deployment, etc.) route to team owners via escalation paths
3. **Forbidden decision blocking** is recorded in the audit trail
4. **Team overlays** in headhunt can promote a temporary expertise into a permanent team capability
