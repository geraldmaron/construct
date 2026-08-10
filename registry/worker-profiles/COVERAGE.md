<!--
registry/worker-profiles/COVERAGE.md — generated render of
registry/worker-profile-coverage.json. Do not hand-edit: run
`npm run worker-profiles:coverage -- --write`.
-->

# Worker Profile coverage matrix

Every Worker Profile joined across skill emphasis, role overlays, policy
overlay, guardrails, and guidance — against a robustness floor
(skills ≥ 5, role overlay present, refusalBoundaries +
anti-fabrication + commit/push fence). A row passes only when every axis clears its minimum.

Floor status: **all pass** — 12 Worker Profiles.

| Worker Profile | Skills | Perspective (+variants) | Guardrails | capabilities/artifacts | Pass |
|---|---|---|---|---|---|
| `architect` | 11 | ✓ +6 | refusal/anti-fab/fence | 4/5 | ✅ |
| `data-analyst` | 7 | ✓ +5 | refusal/anti-fab/fence | 4/0 | ✅ |
| `debugger` | 7 | ✓ +1 | refusal/anti-fab/fence | 0/0 | ✅ |
| `designer` | 9 | ✓ +2 | refusal/anti-fab/fence | 0/0 | ✅ |
| `engineer` | 37 | ✓ +1 | refusal/anti-fab/fence | 4/0 | ✅ |
| `operations` | 19 | ✓ +1 | refusal/anti-fab/fence | 1/5 | ✅ |
| `orchestrator` | 9 | ✓ +1 | refusal/anti-fab/fence | 8/0 | ✅ |
| `product-manager` | 18 | ✓ +6 | refusal/anti-fab/fence | 3/9 | ✅ |
| `qa` | 7 | ✓ +5 | refusal/anti-fab/fence | 0/2 | ✅ |
| `researcher` | 13 | ✓ +1 | refusal/anti-fab/fence | 8/4 | ✅ |
| `reviewer` | 8 | ✓ +1 | refusal/anti-fab/fence | 5/0 | ✅ |
| `security` | 14 | ✓ +7 | refusal/anti-fab/fence | 2/2 | ✅ |

