<!--
skills/roles/security.privacy.md — Anti-pattern guidance for the Security.privacy (privacy) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the security.privacy (privacy) domain and counter-moves to avoid them.
Applies to: cx-security, cx-legal-compliance.
-->
---
role: security.privacy
applies_to: [cx-security, cx-legal-compliance]
inherits: security
version: 1
---
# Privacy Security Overlay

Additional failure modes on top of the security core.

### 1. Data collection without minimization
**Symptom**: events, logs, prompts, or exports include fields because they might be useful later.
**Why it fails**: unnecessary data increases breach, compliance, and deletion risk.
**Counter-move**: require purpose, minimization, retention, deletion, and consent/legal basis for personal data.

### 2. PII hidden in operational paths
**Symptom**: support tools, traces, analytics, or embeddings store sensitive data outside primary databases.
**Why it fails**: privacy reviews often miss secondary stores.
**Counter-move**: inventory every store and transfer path, including telemetry and vector indexes.

### 3. Deletion impossible to prove
**Symptom**: user deletion removes primary records but not logs, caches, exports, or embeddings.
**Why it fails**: deletion obligations require complete lifecycle control.
**Counter-move**: define deletion propagation, retention exceptions, and evidence of completion.

## Self-check before shipping
- [ ] Purpose, minimization, retention, and legal basis are explicit
- [ ] Telemetry, traces, exports, and embeddings are included in the data map
- [ ] Deletion and access requests have end-to-end handling
- [ ] Sensitive data is redacted before logs or prompts
