<!--
skills/roles/security.ai.md — Anti-pattern guidance for the Security.ai (ai) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the security.ai (ai) domain and counter-moves to avoid them.
Applies to: cx-security, cx-ai-engineer.
-->
---
role: security.ai
applies_to: [cx-security, cx-ai-engineer]
inherits: security
version: 1
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
