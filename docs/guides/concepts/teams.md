# Construct Teams Model

> **Problem:** The original profile system aggregated roles by department but lacked explicit accountability, decision rights, and escalation paths. This left teams ambiguous about what they could decide and where to escalate when they hit a boundary.
>
> **Solution:** Teams are the primary organizational unit. Macro **groups** own decision rights; functional **squads** own day-to-day collaboration. Sources live under `specialists/org/` and assemble at runtime (ADR-0046).

## Modular layout (v3)

```
specialists/org/groups/*.json     # macro groups (product-group, …)
specialists/org/teams/*.json      # squads (product-management-team, …)
specialists/org/specialists/*.json
specialists/org/contracts/*.json
specialists/org/policies/*.json
```

`construct registry:validate --unified` validates the assembled registry. `construct team list [--kind group|squad]` and `construct team show <id>` inspect squads.

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
**Roles**: product-manager, designer, researcher

**Decision Rights**: intake-triage, design-approval, scope-change, evidence-requirement  
**Forbidden Decisions**: deployment, security-override, infra-change

**Escalation**: product-manager → architect → orchestrator

**Charter**: Translate user reality into shippable change. Owns problem framing, requirements, evidence gathering, design decisions, and acceptance criteria. Does not own implementation choices, deployment decisions, or security policy. Escalates scope conflicts to R&D leadership.

---

### Engineering Group

**Owner**: Architect  
**Roles**: architect, engineer, debugger

**Decision Rights**: architecture, technology-selection, implementation-approach, performance-optimization  
**Forbidden Decisions**: product-scope, user-research, deployment-timing

**Escalation**: architect → orchestrator

**Charter**: Design, build, and harden the system. Owns architecture decisions, technology choices, code quality, debugging, AI integration, and the platform underneath. Does not own product framing, user research direction, or release timing. Escalates tech-debt conflicts to R&D leadership.

---

### Quality Group

**Owner**: Reviewer  
**Roles**: reviewer, qa

**Decision Rights**: quality-gate-approval, test-strategy, evaluation-design, release-readiness  
**Forbidden Decisions**: scope-change, deployment-timing, architecture

**Escalation**: reviewer → architect → orchestrator

**Charter**: Verify the system does what it claims and surface what is broken. Owns review, testing, evaluation, trace analysis, and devil's-advocate framing. Does not own implementation or product decisions. Escalates quality vs. schedule conflicts to architecture/R&D.

---

### Governance Group

**Owner**: Security  
**Roles**: security

**Decision Rights**: security-approval, compliance-review, risk-assessment, policy-definition  
**Forbidden Decisions**: product-scope, implementation-approach, deployment-readiness

**Escalation**: security → architect → orchestrator

**Charter**: Keep the system safe to operate and inside its legal envelope. Owns security review, compliance verification, risk assessment, and the audit trail. Does not own implementation or product decisions but can block deployments that violate policy. Escalates policy conflicts to orchestrator.

---

### Operations Group

**Owner**: Operations  
**Roles**: operations

**Decision Rights**: deployment, rollback, incident-response, runbook-approval, ops-procedure  
**Forbidden Decisions**: architecture, product-scope, security-policy

**Escalation**: operations → architect → orchestrator

**Charter**: Keep the system running and shipping. Owns release management, SRE response, ops runbooks, documentation upkeep, and deployment execution. Does not own architecture or product decisions. Escalates reliability vs. change-rate conflicts to architecture/leadership.

---

### Strategy Group

**Owner**: Orchestrator  
**Roles**: orchestrator, data-analyst

**Decision Rights**: direction-setting, strategic-prioritization, measurement-design, research-scope, cross-team-orchestration  
**Forbidden Decisions**: implementation-details, user-research-methods, ops-procedures

**Escalation**: architect → orchestrator

**Charter**: Hold the long view: what to build next, what to measure, what to retire. Owns R&D direction, strategic prioritization, measurement design, cross-team orchestration, and exploration. Does not own implementation or day-to-day operations. Arbitrates escalations from other groups.

---

## Team-Aware Policy Gates

Team decision boundaries are enforced by the policy engine (`lib/policy/engine.mjs`). When a tool or action is tagged with a **decision id**, the policy engine checks whether the requesting role's team is allowed to make that decision.

### How It Works

1. **Forbidden Decisions Block First**: If a team's `forbiddenDecisions` list includes the requested decision, the request is denied immediately with reason `team.forbiddenDecisions`.

2. **Specialist Fence Bounded by Team**: A specialist's effective fence (`lib/roles/fence.mjs` `computeEffectiveFence`) intersects their own fence with their team's constraints. A specialist can never exceed their team's authority.

3. **Audit Trail**: When a team-level decision succeeds or fails, it is recorded in `~/.local/state/construct/team-decisions.jsonl` via `recordTeamDecision` and `recordForbiddenDecision` (in `lib/roles/gateway.mjs`).

### Example: Deployment Decision Gate

The Operations Group owns deployments; Product Group cannot.

```javascript
import { policyDecision } from 'lib/policy/engine.mjs';

// Product manager tries to deploy
const decision = policyDecision({
  role: 'product-manager',
  tool: 'deploy',
  action: 'ship',
  decision: 'deployment'  // ← Team decision id
}, { manifests: loadRoleManifests() });

// Result: { allowed: false, reason: '...', source: 'team.forbiddenDecisions' }
// because product-group forbids: ["deployment", "security-override", "infra-change"]
```

```javascript
// Operations tries to deploy
const decision = policyDecision({
  role: 'operations',
  tool: 'deploy',
  action: 'ship',
  decision: 'deployment'
}, { manifests: loadRoleManifests() });

// Result: { allowed: true, ... }
// because operations-group has decisionRights: ["deployment", "rollback", ...]
```

### Integration with Fence Intersection

When a specialist attempts an action that requires team-level decision authority, both gates apply:

1. **Team decision gate** (`forbiddenDecisions` / `decisionRights`) — checked first
2. **Specialist fence** (computed as team fence ∩ specialist fence) — checked on the manifest

A specialist's effective fence is computed by `computeEffectiveFence(personaId, specialistFence, registry)`:
- Team's `forbiddenDecisions` are added to the effective `deniedActions`
- Specialist cannot edit, commit, or push anything the team forbids

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

---

## Team Lifecycle: Adding and Removing Teams

As of Phase 6 (RFC-0004 completion), team and specialist management is unified under a single registry. All team and specialist definitions live in `specialists/org`, and lifecycle operations are enforced by the validator.

### Adding a Team

**Step 1: Edit the unified registry**

```bash
vim specialists/org
```

Add a new entry under the `teams` object:

```json
{
  "teams": {
    "example-group": {
      "name": "Example Group",
      "owner": "example-owner",
      "roles": ["example-owner", "example-member"],
      "decisionRights": ["decision-1", "decision-2"],
      "forbiddenDecisions": ["forbidden-1"],
      "escalationPath": ["example-owner", "architect", "orchestrator"],
      "charter": "Team charter describing scope and responsibility.",
      "contact": {
        "slack": "#example",
        "email": "example@company.com"
      }
    }
  }
}
```

**Step 2: Add at least two specialists to the team**

Every team must have at least one specialist. Add entries under the `specialists` object, setting `"team": "example-group"` for each:

```json
{
  "specialists": {
    "cx-example-owner": {
      "name": "example-owner",
      "displayName": "Example Owner",
      "team": "example-group",
      "role": "owner",
      "skills": ["docs/example-skill"],
      "modelTier": "reasoning"
    },
    "cx-example-member": {
      "name": "example-member",
      "displayName": "Example Member",
      "team": "example-group",
      "role": "member",
      "skills": ["docs/another-skill"],
      "modelTier": "standard"
    }
  }
}
```

**Step 3: Validate**

```bash
construct registry:validate
```

The validator confirms:
- Team exists with at least one specialist
- Owner role has a specialist assigned
- All decision rights reference valid policies
- Escalation path roles are valid
- No circular escalation loops

### Removing a Team

**Safe removal** — the validator prevents orphaning policies or contracts.

```bash
# Remove the team entry and all its specialists from specialists/org
vim specialists/org

# Then validate
construct registry:validate
```

If the team is referenced by any policy (as owner or required approver):

```
Error: Cannot remove team 'example-group' — it is referenced by:
  Policies: deployment, release-gates
  Contracts: construct-to-example
```

Resolve by:
1. **Reassign the policies to another team**, or
2. **Use --force to orphan** (logs warning but allows removal)

### Adding a Specialist

**Step 1: Verify the team exists**

```bash
jq '.teams | keys' specialists/org
```

**Step 2: Edit the unified registry**

Add an entry under `specialists` with `"team": "<team-id>"`:

```json
{
  "specialists": {
    "cx-new-specialist": {
      "name": "new-specialist",
      "displayName": "New Specialist",
      "team": "engineering-group",
      "role": "engineer",
      "skills": ["docs/prd-workflow", "docs/api-design"],
      "modelTier": "reasoning",
      "events": ["feature.requested", "code.review"],
      "fence": {
        "allowedPaths": ["lib/**", "tests/**"],
        "allowedCommands": ["bd create", "bd update"],
        "approvalRequired": ["commit"]
      }
    }
  }
}
```

**Step 3: Optionally create a specialist prompt**

```bash
mkdir -p specialists/prompts
cat > specialists/prompts/cx-new-specialist.md << 'EOF'
# cx-new-specialist

...prompt content...
EOF
```

**Step 4: Validate**

```bash
construct registry:validate
```

### Removing a Specialist

**Unsafe removal is blocked** — the validator prevents orphaning contracts.

```bash
# Remove the specialist from specialists/org
vim specialists/org

# Then validate
construct registry:validate
```

If the specialist is referenced by any contract:

```
Error: Cannot remove specialist 'cx-engineer' — it is referenced by contracts:
  construct-to-engineer, engineer-to-reviewer
```

Resolve by:
1. **Reassign the contracts to another specialist**, or
2. **Use --force to orphan** (logs warning but allows removal)

**Warnings you may see:**

```
WARNING: This is the last specialist on team 'engineering-group'. Team will be understaffed.
WARNING: This specialist has the owner role for team 'engineering-group'. Team will have no owner.
```

These are informational; removal still succeeds. Address by adding another specialist to the team.

### Registry Utilities

**Show changes since last commit:**

```bash
construct registry:diff
```

Output:

```
Teams:
  + new-group
  ~ existing-group

Specialists:
  + cx-new-specialist
  - cx-removed-specialist

Contracts:
  ~ construct-to-new-spec
```

**List orphaned prompts and skills:**

```bash
construct registry:prune
```

Output:

```
Orphaned specialist prompts:
  rm specialists/prompts/cx-removed-specialist.md

Orphaned skills:
  rm skills/roles/old-role.md
```

Run the displayed commands to clean up after removals.

---

## Team Escalation in Action

### Scenario: Product wants scope change, but Engineering says it's infeasible

1. **Product Group** proposes scope change (within their decision rights)
2. **Engineering Group** disagrees or flags technical blocker (may veto)
3. **Escalation**: Product owner escalates to architect
4. **Orchestrator** (Strategy Group owner) arbitrates and makes final call

### Scenario: Someone tries to make a forbidden decision

1. **Product Group** attempts deployment decision (forbidden for them)
2. **Gateway** records forbidden-decision event
3. **Escalation path** is invoked automatically: product-manager → architect → orchestrator
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

Teams in each profile mirror the department structure but add explicit decision boundaries and escalation. Headhunt and orchestration read the active scope at runtime (`lib/scopes/teams.mjs`) so an `operations` project recommends `operations-team`, `engineering-team`, or `product-management-team` on the shared org.

## File Structure

**Unified Registry (RFC-0004 Phase 1+):**
- `specialists/org` — Single source of truth for teams, specialists, roles, contracts, and policies

**Supporting runtime code:**
- `lib/registry/loader.mjs` — Load and parse unified registry
- `lib/registry/validator.mjs` — Validate registry schema and invariants
- `lib/roles/gateway.mjs` — Team escalation lookup functions:
  - `findTeamByRoleOwner(roleId, registry)` — Find team by owner
  - `getTeamEscalationPath(teamId, registry)` — Get escalation chain
  - `canTeamMakeDecision(teamId, decisionId, registry)` — Check authorization
  - `recordTeamDecision(decisionId, teamId, outcome, context)` — Audit trail
  - `recordForbiddenDecision(decisionId, teamId, reason, context)` — Block attempts

**Deprecated (pre-Phase 1 layout):**
- `specialists/teams-registry.json` — Deleted (content migrated into `specialists/org`)
- `specialists/contracts.json` — Deleted (content migrated into `specialists/org/contracts/`)

## Backward Compatibility

## Profile team resolution

Curated **scopes** live in `specialists/org/scopes/`: intake taxonomy, doc templates, tone, hooks. The `construct.config.json` `profile` field selects the active scope (`rnd`, `operations`, `creative`, `research`).

**One org for all scopes.** Teams and roles always load from `specialists/org` at runtime via `lib/scopes/enrich.mjs`. Scopes change how work is classified and labeled — not who exists on the org chart.

Operations-scope routing maps objectives to existing squads (`operations-team`, `engineering-team`, `product-management-team`) via `lib/scopes/teams.mjs`.

## Specialists vs role flavors (ADR-0047)

| Mechanism | Location | Purpose |
|-----------|----------|---------|
| **Specialist** | `specialists/org/specialists/cx-*.json` | Dispatch target: fence, skills, handoffs |
| **Role overlay** | `skills/roles/{name}[.{variant}].md` | Anti-patterns + methodology injected at compose time |

**Naming:** overlay id matches specialist `name` (`ai-engineer`, `platform-engineer`, `business-strategist`). Generalists keep variants under their prefix (`architect.platform`, `qa.web-ui`). Split specialists get a base file; classifiers may add sub-flavors (`data-engineer.pipeline`).

**Bindings:** `lib/roles/flavor-bindings.mjs` maps specialist → classifier key → overlay path. Routing applies the `ai-engineer` / `platform-engineer` / `data-engineer` flavor overlay to `cx-engineer` when keywords match (those roles folded into `cx-engineer`; the overlay loads, no separate specialist is dispatched).

## Current Implementation Status

**RFC-0004 Phases:**
- ✅ **Phase 1**: Unified registry created; legacy files deleted; all consumers migrated
- ✅ **Phase 2**: Team-aware orchestration policy routing
- ✅ **Phase 3**: Contract boundaries and team-aware handoffs
- ✅ **Phase 4**: Policy gates and team-level fences
- ✅ **Phase 5**: Oracle team health oversight
- ✅ **Phase 6**: CLI tooling (`construct registry:diff`, `prune`, `team add/remove`, `specialist add/remove`) and this documentation

**Features deployed:**
1. **Staffing recommendations** surface teams first, then individual roles
2. **Policy gates** (intake approval, deployment, etc.) route to team owners via escalation paths
3. **Forbidden decision blocking** is recorded in the audit trail
4. **Team-aware contract handoffs** require approval when crossing team boundaries
5. **Unified registry validator** enforces team/specialist/contract integrity on every change
6. **Registry utilities** provide safety rails for team/specialist lifecycle operations
