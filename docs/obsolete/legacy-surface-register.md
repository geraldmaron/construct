---
title: Obsolete legacy surface register
status: obsolete
---

# Obsolete legacy surface register

`Obsolete: retained only as historical evidence; not part of Construct 2.0.0.`

The following surfaces are retired and must not receive new consumers:

- `.cx` project and machine-state namespaces
- `specialists/` and `personas/` product roots
- `cx-*` worker identifiers and `CX_*` configuration names
- organization, team, group, and scope execution nouns
- migration and compatibility shims for pre-2.0 schemas
- generated host output that points at retired roots

Current replacements live in `registry/`, `lib/worker-profiles/`,
`lib/workspace-presets/`, `lib/procedures/`, and the assignment/capability
surfaces. Historical changelog, ADR, and research references may remain only
when the containing document is explicitly marked obsolete and is excluded
from active documentation navigation.
