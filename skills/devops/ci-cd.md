<!--
skills/devops/ci-cd.md — CI/CD — Use this skill when designing, debugging, or optimizing CI/CD pipelines.

Use this skill when designing, debugging, or optimizing CI/CD pipelines. ## Pipeline Stages
-->
# CI/CD

Use this skill when designing, debugging, or optimizing CI/CD pipelines.

## Pipeline Stages

| Stage | Purpose | Tools | Failure Policy |
|---|---|---|---|
| Build | Compile, lint, typecheck | tsc, eslint, cargo check, go vet | Fail fast — block all downstream stages |
| Test | Unit → integration → e2e | Jest, Pytest, go test, Playwright | Fail on any; parallelize within stage |
| Security Scan | SAST, dep audit, secrets detection | Semgrep, CodeQL, Trivy, gitleaks | Block on CRITICAL/HIGH; warn on MEDIUM |
| Deploy | Promote artifact through environments | GitHub Actions, ArgoCD, Helm | Gate on all prior stages passing |

Always run lint and typecheck before tests — they are faster and catch more errors per second of CI time.

## GitHub Actions

**Dependency caching:**
```yaml
- uses: actions/cache@v4
  with:
    path: ~/.npm
    key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
    restore-keys: ${{ runner.os }}-node-
```

Use `hashFiles` of the lock file as the cache key. A lock file change invalidates the cache and forces a clean install. Restore keys provide a partial cache hit when the key misses.

**Matrix parallelization:**
```yaml
strategy:
  matrix:
    node: [18, 20, 22]
    os: [ubuntu-latest, macos-latest]
```

**Sequential job dependencies:**
```yaml
jobs:
  build:
    runs-on: ubuntu-latest
  test:
    needs: build
  deploy:
    needs: [build, test]
```

**Artifact passing between jobs:**
```yaml
- uses: actions/upload-artifact@v4
  with:
    name: build-output
    path: dist/
    retention-days: 1

- uses: actions/download-artifact@v4
  with:
    name: build-output
```

## GitLab CI

- `cache: key: $CI_COMMIT_REF_SLUG` with `paths:` for dependency directories.
- `parallel: matrix:` for version or platform fans.
- `artifacts: expire_in: 1 day` for build output passed between jobs.
- `environment: name: staging` for environment tracking and deployment history.

## Artifact Management

| Artifact Type | Where Stored | Retention | Promotion Gate |
|---|---|---|---|
| Build output (JS/CSS) | CI artifact store | 1 day | Tests pass |
| Container image | Registry (ECR, GCR, GHCR) | 90 days (untagged), permanent (tagged) | Security scan pass |
| Test reports | CI artifact store | 30 days | N/A |
| Release binaries | GitHub Releases / S3 | Permanent | Full pipeline pass |

## Environment Promotion

| Branch | Environment | Gates Required |
|---|---|---|
| feature/* | None (CI only) | Build + test |
| main | Staging | Build + test + security scan |
| main (manual approval) | Production | All staging gates + smoke test + approval |
| hotfix/* | Production (fast-path) | Build + test + approval |

Never auto-deploy to production without a passing security scan and at least one manual approval step.

## Secrets in CI

- Store secrets in the platform's encrypted secret store (GitHub Actions Secrets, GitLab CI Variables).
- Never hardcode secrets in workflow files or Dockerfiles.
- Mask secrets in logs — CI platforms do this automatically for registered secrets; verify it works before relying on it.
- Rotate any secret immediately after a potential exposure; treat "may have leaked" the same as "did leak".
- Use OIDC-based short-lived tokens (GitHub OIDC → AWS/GCP/Azure) over long-lived service account keys wherever the cloud provider supports it.

## Speed Optimization

- Cache dependency layers keyed to lock file hash; a clean install on every run is a CI antipattern.
- Run lint and typecheck first — they fail fast and cost less than a full test suite.
- Split slow test suites across workers using matrix or `--shard` flags (Vitest, Jest, Playwright all support sharding).
- Parallelize independent test files; do not serialize unit tests.
- In monorepos, run only affected packages: `turbo run test --filter=[HEAD^1]` or `nx affected --target=test`.
- Set `fail-fast: true` in matrix builds when a single failure is sufficient signal to abort.
