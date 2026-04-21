<!--
skills/roles/security.md — Anti-pattern guidance for the Security role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the security domain and counter-moves to avoid them.
Applies to: cx-security, cx-legal-compliance.
-->
---
role: security
applies_to: [cx-security, cx-legal-compliance]
inherits: null
version: 1
---
# Security — Role guidance

Load this before drafting. These are the failure modes that separate strong role output from weak role output — check your draft against each.


### 1. Defense in absence
**Symptom**: protection depends on a single layer — a firewall, a middleware, a validation step — with no defense if that layer is bypassed.
**Why it fails**: one misconfiguration or bug eliminates all protection at once.
**Counter-move**: assume any single control can fail. Layer controls at the network, application, and data boundaries.

### 2. Secrets in config
**Symptom**: API keys, tokens, or passwords committed to the repo, hardcoded in code, or checked into `.env` files in source control.
**Why it fails**: git history preserves them forever; every developer, CI run, and forked repo now has them.
**Counter-move**: secrets go in a secret manager. The repo contains variable names and example values only.

### 3. Trusting user input
**Symptom**: user-supplied strings concatenated into SQL, shell commands, file paths, URLs, or rendered HTML without validation or escaping.
**Why it fails**: injection attacks are the most common root cause of data breaches. None of them require a clever attacker.
**Counter-move**: validate input at the boundary. Use parameterized queries, safe templating, and path canonicalization.

### 4. No threat model
**Symptom**: security review cannot answer "who are we defending against and what do they want".
**Why it fails**: effort is spent on showy controls while real attack paths go unconsidered.
**Counter-move**: name the attacker, the asset, and the worst-case outcome before choosing controls.

### 5. Authentication without authorization
**Symptom**: the system checks who the user is but not whether they are allowed to do this specific thing with this specific resource.
**Why it fails**: IDOR and privilege-escalation bugs. Any authenticated user can see or modify any record.
**Counter-move**: every protected resource access is accompanied by a per-resource authorization check, not just a session check.

### 6. Silent failures in crypto
**Symptom**: signature verification, token expiry, or certificate validation failures are logged and ignored, or caught and swallowed.
**Why it fails**: an attacker with a forged token or expired session gets the same treatment as a legitimate user.
**Counter-move**: crypto failures halt the operation. Errors are surfaced, not logged-and-continued.

### 7. Rolling your own
**Symptom**: hand-written crypto, session management, password hashing, or random-number generation.
**Why it fails**: subtle flaws that a specialist would catch in seconds but the author will never see.
**Counter-move**: use the standard library or a vetted third-party library. Review configuration, not implementation.

### 8. Error messages that leak
**Symptom**: production errors return stack traces, SQL queries, internal paths, or schema details.
**Why it fails**: gives an attacker a map of the system; turns a reconnaissance step into a freebie.
**Counter-move**: user-facing errors are generic. Detailed context goes to logs with appropriate access controls.

## Self-check before shipping

- [ ] No single control is the only line of defense
- [ ] Secrets live in a secret manager, not in the repo
- [ ] User input is validated and escaped at every boundary
- [ ] Threat model names attacker, asset, and worst case
- [ ] Every protected resource has a per-resource authorization check
- [ ] Crypto failures halt the operation and surface explicitly
- [ ] No custom crypto; vetted libraries only
- [ ] Production errors are generic; details are in controlled logs
