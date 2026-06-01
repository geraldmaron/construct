---
name: exploration-dependency-graph-reading
description: Use when assessing the risk surface of a project's dependencies, planning upgrades, or evaluating a new codebase's supply chain posture.
---
# Dependency Graph Reading

Use when assessing the risk surface of a project's dependencies, planning upgrades, or evaluating a new codebase's supply chain posture.

## npm / package-lock.json

The lockfile is the authoritative record of what actually runs in production.

**What `package-lock.json` tells you:**
- Exact resolved versions of every dependency (direct + transitive).
- The registry URL each package resolved from (watch for non-npm registry sources).
- Integrity hashes for tamper detection (missing or mismatched hashes are a supply chain signal).

**Commands:**
```bash
# Tree of direct dependencies with their transitive deps
npm ls --all --depth=5 <package>

# Why is this package installed? (shows the resolution path)
npm ls <package>

# Outdated direct dependencies
npm outdated

# Audit for known CVEs
npm audit --json | jq '.vulnerabilities | to_entries | sort_by(.value.severity) | reverse[]'
```

**Risk signals in the lockfile:**
- Packages sourced from `github:`, `file:`, or private registries, higher supply-chain risk.
- Very old `lockfileVersion` (v1), may not capture integrity hashes properly.
- Transitive dependencies with `requires: {}` instead of resolved versions, resolution ambiguity.

## Cargo.lock (Rust)

Cargo maintains a flat lockfile with explicit source declarations.

**Key fields:**
- `[[package]]`: each entry is a resolved crate version.
- `source = "registry+..."`: standard crates.io source. `source = "git+..."`: git dependency (less auditable).
- `checksum`: SHA256 of the downloaded crate.

**Commands:**
```bash
# Dependency tree with feature flags
cargo tree

# Find all versions of a crate (version conflicts)
cargo tree -d

# Audit for known vulnerabilities
cargo audit
```

## Maven / gradle (JVM)

The effective POM / resolved configuration tells you what actually runs.

```bash
# Full dependency tree with transitive
mvn dependency:tree -Dverbose

# Resolved versions for a specific scope
mvn dependency:list -Dscope=compile

# Gradle
./gradlew dependencies --configuration runtimeClasspath
```

**Risk signals:**
- Version range declarations (`[1.0,)`), means any future version could be resolved at build time.
- `SNAPSHOT` versions in non-snapshot builds, unstable artifact references.
- Duplicate versions of the same artifact (version conflict, one wins, one is silently dropped).

## Cross-ecosystem risk signals

| Signal | Risk | Action |
|---|---|---|
| Dependency with <100 weekly downloads | Supply chain (abandoned / obscure) | Evaluate inlining or replacing |
| Dependency last published >2 years ago | Maintenance risk | Check for forks or replacements |
| Deep transitive chain (>10 levels) | Blast radius | Map critical path; isolate |
| Single maintainer with no 2FA | Takeover risk | Monitor; prefer alternatives with org ownership |
| Package name squatting (typosquat) | Injection risk | Verify exact package name + registry source |
| Wildcard `*` version pin | Reproducibility failure | Lock to exact version |

## Practical audit workflow

1. **Enumerate the blast radius**: which packages, if compromised, have write access to your production environment or sensitive data? These are the highest-risk nodes.
2. **Check freshness on the critical path**: `npm audit`, `cargo audit`, `snyk test`. Focus on high/critical severity findings that affect runtime code (not devDependencies).
3. **Identify orphaned dependencies**: packages no code imports directly but appear in the lockfile. May be safe to remove, reducing surface area.
4. **Check for version conflicts**: multiple resolved versions of the same package indicate an incomplete deduplication. Usually benign; occasionally a security issue if an old insecure version is in the tree.
