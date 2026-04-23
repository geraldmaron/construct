<!--
skills/devops/dependency-management.md — Dependency Management — Use this skill when managing package upgrades, resolving CVEs, or establishing l

Use this skill when managing package upgrades, resolving CVEs, or establishing lock file and versioning policy. ## Lock File Hygiene
-->
# Dependency Management

Use this skill when managing package upgrades, resolving CVEs, or establishing lock file and versioning policy.

## Lock File Hygiene

- Always commit lock files: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `go.sum`, `Cargo.lock`.
- Never delete and regenerate a lock file without reviewing the full diff; regeneration silently upgrades all transitive dependencies.
- Review lock file diffs in PRs for unexpected transitive version changes — these are where supply chain attacks hide.
- Do not add lock files to `.gitignore`; they are the reproducibility contract for the build.
- A PR that changes only the lock file (no `package.json` change) warrants careful scrutiny.

## Safe Upgrade Strategies

| Tool | Trigger | Grouping | Auto-merge Policy |
|---|---|---|---|
| Dependabot | Daily/weekly schedule | One PR per package by default; group with `groups:` config | Patch: auto-merge if CI passes. Minor: batch weekly, manual review. Major: manual always. |
| Renovate | Configurable schedule | Group by ecosystem, semver range, or custom regex via `packageRules` | Auto-merge patch and minor with passing CI; use `stabilityDays: 3` to avoid merging on day of release |

Prefer Renovate for complex repos — its `rangeStrategy`, `grouping`, `stabilityDays`, and `automerge` controls are more expressive than Dependabot's.

Always require CI to pass before any auto-merge. Never auto-merge major version bumps.

## Transitive CVE Resolution

Run `npm audit --json` and parse the output. Each finding includes `severity`, `via` (the dependency chain), and `fixAvailable`.

Force a transitive version without upgrading the direct dependency:

In `package.json` (npm/pnpm):
```json
"overrides": {
  "vulnerable-transitive-dep": ">=2.3.1"
}
```

In `package.json` (yarn):
```json
"resolutions": {
  "vulnerable-transitive-dep": "2.3.1"
}
```

Risks of `npm audit fix --force`: it may install a semver-incompatible version and break the direct dependency. Always run your test suite after applying forced fixes. Prefer manual overrides over `--force` for production packages.

Verify the fix took effect: run `npm ls vulnerable-transitive-dep` and confirm the version in the tree.

## Version Pinning Policy

| Context | Policy | Reason |
|---|---|---|
| Production app | Pin exact versions (`"react": "18.2.0"`) | Reproducible builds; no surprise upgrades in prod |
| Library / published package | `^` for minor, `~` for patch | Consumers need flexibility; too-tight pins create version conflicts |
| Dev dependencies | `^` acceptable | Test/build tools rarely cause production regressions |
| Security-critical deps (auth, crypto, TLS) | Pin exact regardless of context | Breaking changes in security libs have outsize impact |
| CI tool versions (actions, runners) | Pin to SHA or exact tag | Unpinned actions are a supply chain attack surface |

## Vendoring Decisions

Vendor when:
- Builds must work offline or in air-gapped environments.
- Supply chain risk is critical and you need full control of the source.
- You have a stability SLA that cannot tolerate upstream changes.

Go: `go mod vendor` copies all dependencies into `vendor/`; pass `-mod=vendor` to enforce it.

pnpm strict mode: avoid `--shamefully-hoist`; it recreates the flat `node_modules` structure that allows phantom dependency bugs. Use strict mode by default and resolve missing hoisted deps explicitly.

Trade-offs: vendoring increases repo size and creates a maintenance burden to keep vendored copies patched. Weigh against the reproducibility and supply chain benefits for your threat model.

## Audit Workflows

| Ecosystem | Command | CI Integration |
|---|---|---|
| Node.js | `npm audit --audit-level=high` | Run on every PR; fail on HIGH+ |
| Python | `pip-audit` | Run after `pip install`; fail on CRITICAL |
| Rust | `cargo audit` | Run in CI; fail on CRITICAL |
| Go | `govulncheck ./...` | Run in CI; fail on CRITICAL |

Severity thresholds:
- CRITICAL: block CI, block merge, fix immediately.
- HIGH: block merge; fix before shipping.
- MEDIUM: open a tracked issue; fix within the current sprint.
- LOW: log; fix in a batch dependency upgrade PR.

Automate audit on every PR, not just on a schedule. A scheduled audit catches vulnerabilities too late relative to when the dependency was introduced.
