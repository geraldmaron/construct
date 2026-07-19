---
name: perspectives-security-ai
description: Provides perspective-specific anti-patterns, failure modes, and counter-moves for Worker Profile execution.
inputs: [ai-system, task-context]
artifactType: guidance
perspective: security.ai
applies_to:
  - security
  - engineer
inherits: security
version: 2
scopes:
  - rnd
cap: 1
---
# AI Security Overlay

Additional failure modes on top of the security core.

### 1. Prompt injection treated as prompt quality
**Symptom**: hostile instructions in retrieved or user-provided content are handled by stronger wording.
**Why it fails**: model obedience is not a security boundary.
**Counter-move**: separate data from instructions, constrain tools, validate outputs, and deny unsafe actions by policy.

### 2. Tool access too broad
**Symptom**: the model can call tools unrelated to the current task or with unchecked arguments.
**Why it fails**: compromised context can trigger real side effects.
**Counter-move**: scope tools per task, validate schemas, and require approval for destructive or external actions.

### 3. Retrieval leaks data
**Symptom**: vector search ignores tenant, permission, retention, or sensitivity labels.
**Why it fails**: embeddings can bypass normal access-control paths.
**Counter-move**: enforce ACL-aware retrieval, source citation, redaction, and index freshness checks.

## Self-check before shipping
- [ ] Prompt injection paths are modeled
- [ ] Tool access is scoped and schema-validated
- [ ] Retrieval respects ACL, tenant, retention, and sensitivity boundaries
- [ ] Unsafe outputs have validation or human review
