<!--
skills/devops/devsecops.md — DevSecOps — Use this skill when integrating security into CI/CD pipelines, managing supply c

Use this skill when integrating security into CI/CD pipelines, managing supply chain risk, or automating security scanning. ## Pipeline Security Stages
-->
# DevSecOps

Use this skill when integrating security into CI/CD pipelines, managing supply chain risk, or automating security scanning.

## Pipeline Security Stages

### Pre-Commit
- Secret scanning: detect credentials before they reach the repo
- Tools: gitleaks, truffleHog, git-secrets
- Pre-commit hooks for fast local feedback
- Block commits containing patterns matching API keys, tokens, certificates

### Build
- SAST: static application security testing on source code
- Dependency scanning: check for known CVEs in direct and transitive dependencies
- License scanning: flag incompatible or unapproved licenses
- Container image scanning: vulnerabilities in base images and installed packages
- Fail the build on Critical findings; warn on High

### Test
- DAST: dynamic scanning against a running instance in CI
- API security testing: fuzz endpoints, test auth bypass
- Infrastructure-as-code scanning: misconfigurations in Terraform, CloudFormation, Helm
- Compliance-as-code: CIS benchmarks, custom policies

### Deploy
- Image signing and verification (cosign, Notary)
- Admission controllers enforce signed images only
- Runtime security policies (Falco, AppArmor, seccomp)
- Secrets injected from vault at deploy time, not baked into images

### Runtime
- Runtime application self-protection (RASP) where applicable
- Container runtime monitoring
- Network policy enforcement
- Continuous compliance scanning

## Supply Chain Security

### Dependency Management
- Pin exact versions in lock files
- Verify checksums of downloaded packages
- Use private registries or mirrors for critical dependencies
- Audit new dependencies before adding: maintainer reputation, download count, known issues
- Automate dependency updates with PR-based tools (Dependabot, Renovate)

### SBOM (Software Bill of Materials)
- Generate SBOM in CycloneDX or SPDX format
- Include in build artifacts
- Track components across all deployed services
- Automate SBOM comparison against vulnerability databases

### Container Security
- Use minimal base images (distroless, Alpine, scratch)
- Pin base image by digest, not tag
- Scan images at build and before deployment
- No secrets in image layers; use runtime injection
- Run containers as non-root with read-only filesystem where possible

## Secret Management in CI/CD

- Store secrets in the CI/CD platform's secret store or external vault
- Never print secrets in build logs
- Mask secret values in CI output
- Rotate CI/CD secrets on a schedule
- Audit secret access: who used which secret, when

## Policy as Code

- Define security policies in a machine-enforceable format
- OPA/Rego for Kubernetes admission control
- Sentinel or OPA for Terraform plan validation
- Custom policies for organization-specific requirements
- Version policies alongside code; review changes via PR

## Metrics

- Mean time to remediate (MTTR) by severity
- Percentage of builds with zero Critical/High findings
- Dependency freshness: age of oldest dependency
- SBOM coverage: percentage of services with current SBOM
- Secret rotation compliance rate
- Policy violation trend over time

## Incident Response Integration

- Security findings automatically create tickets in the issue tracker
- Critical findings trigger immediate notification
- Runbook for each finding category
- Post-incident review includes pipeline gap analysis
- Update pipeline rules based on incident learnings
