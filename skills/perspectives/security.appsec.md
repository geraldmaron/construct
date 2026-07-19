---
name: perspectives-security-appsec
description: Provides perspective-specific anti-patterns, failure modes, and counter-moves for Worker Profile execution.
inputs: [code-diff, task-context]
artifactType: guidance
perspective: security.appsec
applies_to:
  - security
inherits: security
version: 2
scopes:
  - rnd
cap: 1
---
# AppSec Overlay

Additional failure modes on top of the security core.

### 1. Trusting framework defaults
**Symptom**: auth, CSRF, XSS, serialization, or validation is assumed safe because the framework usually handles it.
**Why it fails**: custom glue code is where defaults stop applying.
**Counter-move**: trace untrusted input from boundary to sink and verify explicit controls at each hop.

### 2. Authorization checked only at the UI
**Symptom**: controls hide actions but APIs still accept them.
**Why it fails**: attackers call APIs directly.
**Counter-move**: verify server-side authorization for every privileged operation.

### 3. Errors and logs leak context
**Symptom**: debug details, identifiers, tokens, or PII are logged or returned.
**Why it fails**: observability becomes data exposure.
**Counter-move**: check log paths and error responses for sensitive data.

## Self-check before shipping
- [ ] Input-to-sink paths are traced
- [ ] Server-side authorization gates privileged operations
- [ ] Error and log output avoids sensitive data
- [ ] Tests cover malicious and unauthorized requests
