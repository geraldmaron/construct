# QA Strategy: {feature or system name}

- **Date**: {YYYY-MM-DD}
- **Owner**: {name or role}
- **Status**: draft | in-review | approved | executed
- **Related**: {PRD / ADR paths or none}

<!--
Use this when a feature, migration, or system change needs a deliberate
verification strategy before it ships. The plan is the contract between
what was specified and what will be proven; every scenario below must
trace to a requirement or an observed risk, never to guesswork.

Before drafting, read rules/common/framing.md and rules/common/no-fabrication.md.
Acceptance criteria must be binary pass/fail. If a criterion cannot be
checked without asking the author, it is not done. Cite the requirement
(FR/NFR id, ADR decision, ticket) each scenario verifies.
-->

## Scope
<!--
What is under test and what is explicitly not. Name the components, surfaces,
or behaviors covered. The out-of-scope list protects reviewer attention and
makes coverage gaps deliberate rather than accidental.
-->

| | Description |
|---|---|
| **In scope** | <what this plan verifies> |
| **Out of scope** | <related behavior deliberately not tested here, and why> |

## Test strategy
<!--
The levels of testing applied and why each is justified. Map levels to risk:
unit for logic, integration for contracts and boundaries, end-to-end for
user-visible flows, manual/exploratory for what automation cannot reach.
State what each level is responsible for so coverage gaps are visible.
-->

| Level | What it covers | Why it lives at this level |
|---|---|---|
| Unit | <logic, pure functions, edge cases> | <reason> |
| Integration | <contracts, boundaries, data access> | <reason> |
| End-to-end | <user-visible flows> | <reason> |
| Manual / exploratory | <what automation cannot reach> | <reason> |

## Coverage

| Scenario | Type | Priority |
|---|---|---|
| TC-1 | unit / integration / e2e | P0 / P1 / P2 |
| TC-2 | <...> | <...> |

## Key scenarios
<!--
The scenarios that prove the change works. Each scenario names the requirement
it verifies, the setup, the action, and the binary acceptance criterion. A
reviewer must be able to run or read the scenario and decide pass/fail without
asking the author.
-->

| ID | Scenario | Verifies | Acceptance (binary pass/fail) |
|---|---|---|---|
| TC-1 | <setup, action, expected result> | <FR/NFR id or risk> | <observable condition> |
| TC-2 | <...> | <...> | <...> |

## Risks and edge cases
<!--
The failure modes and boundary conditions worth explicit attention: empty
inputs, concurrency, partial failure, large data, permission boundaries,
rollback. For each, state how the plan covers it or why the residual risk
is accepted.
-->

| Risk / edge case | Likelihood | Impact | Coverage or accepted reason |
|---|---|---|---|
| <condition> | low / med / high | low / med / high | <how it is tested, or why accepted> |

## Environments and data
<!--
Where tests run and what data they use. Name the environments, fixtures,
seed data, and any external dependencies (sandboxes, stubs, recorded
responses). Flag data that must be synthetic or anonymized.
-->

## Entry and exit criteria
<!--
Entry: what must be true before testing starts (build available, environment
provisioned, dependencies stubbed). Exit: what must be true to call testing
done (all blocking scenarios pass, known issues triaged, coverage threshold
met). Both are checklists a reviewer can verify.
-->

**Entry criteria**

- <condition that must hold before execution begins>

**Exit criteria**

- <condition that must hold to declare the plan executed>

## References
<!-- PRD, ADR, RFC, related test plans, prior incidents. -->
