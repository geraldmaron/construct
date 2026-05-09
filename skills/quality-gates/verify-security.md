<!--
skills/quality-gates/verify-security.md — Verify Security — Use this skill to scan code for security vulnerabilities before commits or relea

Use this skill to scan code for security vulnerabilities before commits or releases. ## Scan Scope
-->
# Verify Security

Use this skill to scan code for security vulnerabilities before commits or releases.

## Scan Scope

Analyze all changed files plus their direct dependencies for the categories below.

## Secrets and Credentials

- [ ] No hardcoded API keys, passwords, tokens, or connection strings
- [ ] No private keys or certificates committed
- [ ] `.env` files excluded from version control
- [ ] Secrets loaded from environment variables or a secret manager
- [ ] No secrets in logs, error messages, or stack traces

**Severity**: Hardcoded secret = Critical. Secret in logs = High.

## Authentication and Authorization

- [ ] Authentication required on all protected endpoints
- [ ] Authorization checks enforce least privilege
- [ ] Session tokens are cryptographically random and expire
- [ ] Password storage uses bcrypt, scrypt, or argon2 with sufficient rounds
- [ ] Multi-factor authentication supported where appropriate
- [ ] No authentication bypass via parameter tampering or path traversal

**Severity**: Auth bypass = Critical. Missing authz check = High. Weak hash = High.

## Injection

- [ ] SQL queries use parameterized statements or an ORM
- [ ] No string concatenation in queries, commands, or templates
- [ ] OS command execution uses allowlists, never user input directly
- [ ] LDAP, XML, and template injection vectors reviewed

**Severity**: SQL/OS injection = Critical. Template injection = High.

## Cross-Site Scripting (XSS)

- [ ] All user-supplied data escaped before rendering in HTML
- [ ] No use of `innerHTML`, `dangerouslySetInnerHTML`, or `v-html` without sanitization
- [ ] Content-Security-Policy header configured
- [ ] Reflected, stored, and DOM-based XSS vectors checked

**Severity**: Stored XSS = Critical. Reflected XSS = High. DOM XSS = High.

## Cross-Site Request Forgery (CSRF)

- [ ] State-changing requests require CSRF tokens
- [ ] SameSite cookie attribute set to Lax or Strict
- [ ] Custom headers validated for API endpoints

**Severity**: Missing CSRF on state change = High.

## Dependencies

- [ ] No known CVEs in direct or transitive dependencies
- [ ] Lock file committed and up to date
- [ ] No unnecessary dependencies
- [ ] Audit command run: `npm audit`, `pip audit`, `cargo audit`, or equivalent

**Severity**: Critical CVE = Critical. High CVE = High. Outdated dep = Medium.

## Cryptography

- [ ] TLS 1.2+ enforced for all network communication
- [ ] No use of MD5, SHA1, DES, or RC4 for security purposes
- [ ] Random values generated with cryptographic PRNG
- [ ] Key lengths meet current standards (RSA 2048+, AES 256)

**Severity**: Broken crypto = High. Weak random = High. Deprecated algo = Medium.

## Data Exposure

- [ ] Sensitive fields excluded from API responses and logs
- [ ] Error messages do not leak internal paths, stack traces, or versions
- [ ] Debug endpoints disabled in production
- [ ] Rate limiting on authentication and sensitive endpoints

**Severity**: PII leak = Critical. Stack trace in prod = Medium. Missing rate limit = Medium.

## Severity Reference

| Level | Meaning | Action |
|---|---|---|
| Critical | Exploitable vulnerability or data breach risk | Must fix before merge |
| High | Significant security weakness | Should fix before merge |
| Medium | Defense-in-depth gap | Fix when practical |
| Low | Hardening suggestion | Optional |
