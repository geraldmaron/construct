<!--
skills/compliance/license-audit.md — License Audit — Dependency license review and open-source compliance.

Use this skill when auditing dependency licenses, evaluating OSS compliance risk, or preparing license inventories for legal review.
-->
# License Audit

Use this skill when auditing dependency licenses, evaluating OSS compliance risk, or preparing license inventories for legal review.

## License Classification

| Risk Tier | Licenses | Action |
|-----------|----------|--------|
| Permissive | MIT, BSD-2, BSD-3, ISC, Apache-2.0, Unlicense | Safe for most uses |
| Weak copyleft | LGPL-2.1, LGPL-3.0, MPL-2.0, EPL-2.0 | Review linking model |
| Strong copyleft | GPL-2.0, GPL-3.0, AGPL-3.0 | Legal review required |
| Non-commercial | CC-BY-NC, SSPL, BSL, Elastic-2.0 | Block for commercial use |
| Unknown/Custom | No SPDX identifier, custom terms | Manual review required |

## Audit Process

1. Generate SBOM: use `npm list --all --json`, `pip licenses`, `cargo license`, or equivalent
2. Identify every direct and transitive dependency
3. Map each dependency to its SPDX license identifier
4. Flag any dependency without a clear license file as unknown-risk
5. Check for license changes between pinned versions and latest
6. Look past layer one — transitive copyleft taints the whole tree

## Red Flags

- AGPL-3.0 in any network-exposed service dependency
- GPL in a library linked into proprietary code without a linking exception
- Mixed licensing where copyleft and proprietary code share a compilation unit
- Dependencies that changed from permissive to restrictive between versions
- "License: SEE LICENSE IN ..." with no actual license file present
- Dual-licensed packages where the free option is copyleft

## Deliverable

Produce a license inventory table: dependency name, version, license SPDX, risk tier, notes. Flag every non-permissive entry with a recommended action (accept, replace, seek exception, or block).
