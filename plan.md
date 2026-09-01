# Clean-slate alpha reconciliation — living plan

Epic: `construct-cki1`.

## Baseline

| Fact | Value |
|------|-------|
| package.json | `3.0.0-alpha.20` |
| npm `alpha` (pre-publish) | `3.0.0-alpha.19` (**untrusted** — no gitHead) |
| Compatibility | **none** |
| Release verdict | **READY FOR NEW ALPHA** |

## Phase status

| Phase | Bead | Status |
|-------|------|--------|
| A–I | … | **done** |
| J Package/release | construct-umx9 | **done** (verdict + tag) |

## Phase J ledger

| Target | Status |
|--------|--------|
| Full gate (lint/typecheck/test/smoke) | **done** |
| CI full gate on PR/push | **done** |
| Complexity vs Phase A baseline | **done** (in release verdict) |
| Release verdict READY FOR NEW ALPHA | **done** |
| Version `3.0.0-alpha.20` + tag `v3.0.0-alpha.20` | **done** |
| npm publish via release.yml | **on tag push** |

## What remains overall

```
DONE   A–J (clean-slate epic)
NEXT   Confirm npm alpha → 3.0.0-alpha.20 with gitHead after release workflow
OPEN   Outside epic: install-to-first-value, consumer packets, staff, PRD→tracker,
       pack breadth, privacy/EDR bug (construct-hn41)
```

Detail: `docs/internal/clean-slate-inventory.md`,
`docs/internal/clean-slate-release-verdict.md`.
