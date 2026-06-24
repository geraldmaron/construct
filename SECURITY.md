# Security Policy

## Supported versions

Security fixes target the latest published `@geraldmaron/construct` release on npm. Upgrade to the newest version before reporting an issue you cannot reproduce there.

## Reporting a vulnerability

Report privately through GitHub's **[Security Advisories](https://github.com/geraldmaron/construct/security/advisories/new)** ("Report a vulnerability") on this repository. Do not open a public issue for an unfixed vulnerability.

Include where you can: affected version, reproduction steps, the dependency path (`npm ls <pkg> --all`), and `npm audit --json` output for dependency findings.

## Response targets

| Stage | Target |
|---|---|
| Acknowledge report | 3 business days |
| Triage + severity assessment | 7 business days |
| Fix released — critical / high | next patch release, within 14 days of triage |
| Fix released — moderate / low | next scheduled release |

These are targets, not guarantees; an issue requiring an upstream fix is bounded by the upstream's timeline, which we will state in the advisory.

## Dependency vulnerabilities

The published CLI keeps a deliberately small runtime dependency surface (see [docs/decisions/adr/0001-zero-npm-core.md](docs/decisions/adr/0001-zero-npm-core.md)). Two audit gates guard releases:

- `npm audit --omit=dev --audit-level=high` — the repository's own tree.
- `npm run audit:published` — the **artifact a consumer installs**, packed and audited in a clean project with no `overrides` in scope. This is the gate that catches a transitive advisory a repo-local override would mask.

Remediation follows the ladder in [docs/dependencies.md](docs/dependencies.md#transitive-vulnerability-remediation): bump → replace/remove → demote to optional → ADR-justified accept.

### Interim mitigation for consumers

An npm `overrides` pin in **your own** project's `package.json` *does* take effect — `overrides` apply to the top-level project doing the install. While awaiting a Construct release, you can pin a patched transitive version yourself:

```json
{
  "overrides": {
    "<vulnerable-package>": "<patched-version>"
  }
}
```

To avoid the local ONNX embedding stack entirely, set `CONSTRUCT_EMBEDDING_MODEL=hashing`; Construct then uses its zero-dependency in-tree embedder and the transformers/ONNX chain is never loaded.

## Handling of secrets and audit trails

Operational security guidance — credential handling, secret-scanning hooks, the tamper-evident audit trail, and dashboard hardening — lives in [docs/security.md](docs/security.md).
