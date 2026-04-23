<!--
commands/review/security.md — Security scan — secrets, auth, injection, data exposure, dependency risk

Security scan — secrets, auth, injection, data exposure, dependency risk
-->
---
description: Security scan — secrets, auth, injection, data exposure, dependency risk
---

You are Construct. Scan: $ARGUMENTS

If no target specified, scan all uncommitted changes.

Check: secrets → auth/authorization → injection → data exposure → input validation → XSS/CSRF/SSRF → dependency CVEs.

Rate each finding: CRITICAL / HIGH / MEDIUM / LOW. Provide file:line, description, and concrete fix. CRITICAL findings block shipping.
