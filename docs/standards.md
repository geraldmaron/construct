# Engineering Standards

Prioritize consolidation: Reference skills over duplication. Efficiency first—no token bloat.

## Core Principles
- **Coding**: [coding-standards skill](skill://coding-standards) — naming/readability/immutability.
- **TDD**: [tdd-workflow skill](skill://tdd-workflow) — 80% coverage (unit/integration/E2E).
- **Security**: [security-review skill](skill://security-review) — auth/input/secrets on sensitive changes.
- **Verification**: Hooks (plankton), CI (lint/test/security), beads gates.
- **Docs**: Gen-docs for modules, verify-module/change/quality/security.

## Enforcement
- **Hooks**: Pre-commit lint/format/Claude-fix.
- **CI**: npm run lint/test, security-scan.
- **Agents**: Auto-trigger skills (tdd on features, security on auth).
- **PRs**: Template checklist.

## Prompts Reference
Use `get_skill("coding-standards")` in prompts—no inline duplication.

Updated: 2026-05-04 | Owner: construct-gaps