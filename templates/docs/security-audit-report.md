# Security Audit Report: {scope-title}

- **Date**: {YYYY-MM-DD}
- **Auditor**: security (or named human)
- **Scope**: {repo / module / PR / threat-model version}
- **Threat model**: {path or "n/a"}
- **Verdict**: SAFE | ISSUES_FOUND | BLOCKED
- **Status**: draft | final

<!--
Think like an attacker — the attack surface the developer didn't know existed. Every claim
cites a CVE, a code path (file:line), a known attack pattern, or a reproducible repro. A
suspected risk you can't pinpoint is a question, not a finding.
-->

## Executive summary
<!-- 2–4 sentences: what was audited, count of findings by severity, the single most important thing the reader needs to know. -->

## Audit categories covered

- [ ] Secrets (hardcoded API keys, tokens, credentials in source or config)
- [ ] AuthN / AuthZ (bypass paths, missing checks, JWT validation gaps, privilege escalation)
- [ ] Injection (SQL, command, LDAP, template, SSTI, prompt)
- [ ] Data exposure (PII in logs, verbose errors, overbroad permissions)
- [ ] Input validation (unvalidated user input reaching dangerous sinks)
- [ ] XSS / CSRF / SSRF
- [ ] Dependencies (known CVEs in direct dependencies)
- [ ] Cryptography (weak algorithms, hardcoded keys, insufficient entropy)
- [ ] Compliance / privacy obligations (retention, deletion, disclosure, licensing — see Compliance section)

<!-- Tick boxes for what was actually examined. A category not ticked is not "passed" — it's "not audited." Say so. -->

## Findings

| Category | Severity | Location | Trigger | Evidence | Recommended Fix |
|---|---|---|---|---|---|
| {one of the categories above} | critical / high / medium / low | `path/to/file.ext:NNN` | {how an attacker reaches it} | CVE-NNNN / repro / pattern | {minimum patch} |

## Compliance

Complete when PII, regulated processing, licensing, or contractual a11y appears. Produce or link a `compliance-memo` / DPIA when triggers fire. Not legal advice.

| Obligation class | Present? | Control evidence | Residual risk | Follow-up artifact |
|---|---|---|---|---|
| Privacy / PII | yes / no / unknown | {path or missing} | {…} | dpia-or-privacy-assessment / none |
| Regulatory / contractual | yes / no / unknown | {…} | {…} | compliance-memo / none |
| License / supply chain | yes / no / unknown | {SBOM / license scan} | {…} | license-audit / none |
| Accessibility as legal duty | yes / no / unknown | {audit path} | {…} | accessibility-audit / legal-compliance |

## Remediation priority
<!-- Order the findings by what to fix first. Group critical/high together; medium/low can be backlogged with explicit acceptance. -->

## Out of scope
<!-- Audit boundaries: what the auditor did not look at, and why. Future audits may need to. -->

## Handoff

- code fix → `next:engineer`
- platform / infrastructure fix → `next:engineer`
- compliance memo / counsel → `security.legal-compliance` + `templates/docs/compliance-memo.md`
- review of remediation → `next:reviewer`
