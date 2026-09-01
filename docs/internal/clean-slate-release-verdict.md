# Clean-slate release verdict

Epic: `construct-cki1` · Phase J: `construct-umx9`  
Measured: 2026-09-01 · HEAD at verdict prep: see git tag `v3.0.0-alpha.20`  
Follow-on dogfood cut: `v3.0.0-alpha.21` (post-20 hardening; no external testers)

## Verdict

**READY FOR NEW ALPHA** (clean-slate) · **alpha.21 published for Gerald dogfood**

Not “mostly ready.” Architecture phases A–I landed. Local gate green. PR CI
runs the full gate. `3.0.0-alpha.20` was the intentional provenance rebuild.
`3.0.0-alpha.21` carries post-20 dogfood hardening and states there is no
external-tester program — Gerald’s recorded outcomes are the only acceptance
surface. Registry `3.0.0-alpha.19` remains untrusted (no `gitHead`, no matching
git tag).

## Provenance

| Fact | Value |
|------|-------|
| package.json | `3.0.0-alpha.21` |
| git tag | `v3.0.0-alpha.21` → see tag after publish |
| npm `alpha` | `3.0.0-alpha.21` · `gitHead` must match tag SHA |
| Prior cut | `v3.0.0-alpha.20` → `139f9c3ff3e94e7bc73811d7a87db7d5598e8ccf`; release [33464280447](https://github.com/geraldmaron/construct/actions/runs/33464280447) |

**Triple agreed** for alpha.20 (2026-09-01). alpha.21 is verified the same way
after the release workflow finishes: package version, git tag commit, and npm
`gitHead` are the same SHA.

First tag push of `v3.0.0-alpha.20` failed release smoke (unknown verb printed
help without saying `unknown`). Fixed on main; tag moved to the fix commit
before the successful publish.

## Gate (local, 2026-09-01, before alpha.21 tag)

| Check | Result |
|-------|--------|
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm test` | 3028 pass / 0 fail |
| `npm run smoke` | pass |

## Complexity vs Phase A baseline

| Metric | Phase A (before) | After clean-slate | Δ |
|--------|-----------------:|------------------:|---|
| Public CLI verbs | 41 | 37 | −4 |
| Internal CLI verbs | 2 | 1 | −1 |
| MCP unique tool names (interactive) | 18 | 13 | −5 |
| SQLite `CREATE TABLE` sites | 37 (schema 23) | format-v1 project state; home store still present for legacy paths | replaced primary |
| State format | schema 23 | `construct-state` v1 | rewrite |
| Background product verbs | standing+watch+schedule+daemon | deleted (Routine manual) | −4 concepts |
| Portable skills on disk | 7 | 8 (7 method + operational `construct`) | +1 operational |
| Generated lens packs | 15 | 15 (explicit `skills pack` only) | unchanged count; out of auto-install |
| Production LOC `src/**/*.ts` | 55,288 | 52,809 | −2,479 |
| Test LOC `tests/**/*.ts` | 53,322 | 47,084 | −6,238 |
| Package exports | deep `./kernel/*` `./hosts/*` | `"."` only | locked |

## Deletion ledger (summary)

Closed under Phases G–I: wire, host-pull product path, cleanup, naming_cache,
keyword product staffing, standing/watch/schedule/daemon CLIs, package
session-drift, deep exports, experiment PRs #9/#11/#12/#13. Skills
requalified (H). Docs/help init-first (I).

## Gaps named (not blockers for this verdict)

- A/B skill qualification and observed cross-host skill load remain unmet
  (named on Phase H scorecards).
- Live host conformance stays outside PR CI (credentials); still required on
  the release workflow / probe scripts before claiming host truth.
- Live Jira/GitHub transports remain deferred (`construct-a9yx`); prefer host
  MCP / `--live=` until a recorded probe wires them.

## What this does not claim

- Phase 5 stakeholder-acceptance / `latest` promotion.
- Compatibility with any prior alpha.
- That dogfood-only legal/compliance output is advice.
- Any external-tester program or cross-user success rate — none exist and none
  are planned; Gerald dogfood is the only acceptance surface.
