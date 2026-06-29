---
name: roles-qa-api-contract
description: Surfaces anti-patterns, failure modes, and counter-moves specific to the QA — API Contract role. Use when reviewing or generating work by cx-qa, cx-test-automation, or when an agent is acting in the QA — API Contract role.
inputs: [api-spec, test-suite]
artifactType: guidance
role: qa.api-contract
applies_to:
  - cx-qa
  - cx-test-automation
inherits: qa
version: 2
scopes:
  - rnd
cap: 1
---
# API Contract QA Overlay

Additional failure modes on top of the QA core.

### 1. Testing only the current client
**Symptom**: tests pass through one frontend but do not validate the API contract.
**Why it fails**: other clients, SDKs, and integrations break without local test failure.
**Counter-move**: verify request/response schemas, status codes, errors, compatibility, and deprecation behavior.

### 2. Happy-path payload bias
**Symptom**: fixtures contain ideal input and complete data.
**Why it fails**: contracts fail at boundaries: missing fields, unknown enum values, pagination, rate limits, and auth states.
**Counter-move**: add negative, boundary, and compatibility cases.

### 3. No consumer perspective
**Symptom**: tests validate implementation details but not consumer expectations.
**Why it fails**: provider changes can be technically valid and still break real consumers.
**Counter-move**: add consumer-driven contract tests where the API is external or shared.

## Self-check before shipping
- [ ] Schemas, status codes, error bodies, and auth states are verified
- [ ] Compatibility and deprecation behavior have tests
- [ ] Boundary payloads, pagination, and rate limits are covered
- [ ] Consumer expectations are represented
