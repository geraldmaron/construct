# Approved retries and expired leases

The independent review cleared the two P1s, unchanged-read freshness and original lease recovery at runtime `2b1720e0`. It then reproduced a separate P2: after zero, one or two expired leases, approving one more validation attempt admitted one, two or three failures. The approval increment counted expired attempts; enforcement did not.

## Change

[grantExtraAttempt](../../../src/kernel/state/steps.ts) now sets the maximum from `attempts - expiredAttempts + 1` in its existing transaction. Fencing attempt numbers and the separate expiration limit are preserved. Validator-specific waiver enforcement is unchanged.

[Public broker regressions](../../../tests/kernel/broker/retry-budget.test.ts) cover zero, one and two expirations, both another-attempt and accept-with-problems decisions, a newly failing validator outside the waiver, clearing a previous waiver, and successful artifact delivery with a real command receipt. They use the normal tool schemas and lifecycle; database writes do not fabricate state. The fixture accepts an injected clock solely to exercise lease expiry without sleeping.

## Evidence

- Before the runtime fix: **2 pass, 4 fail**, exactly the one- and two-expiration cases. [Reproduction](evidence/retry-grant-before.log).
- After: **34 focused tests pass**, including existing waiver and architecture-journey regressions. [Focused log](evidence/retry-grant-focused.log).
- Full gate: **868 pass, zero failures, one existing skip**; lint, typecheck and packaged-install smoke pass. [Tests](evidence/retry-grant-tests.log), [lint](evidence/retry-grant-lint.log), [types](evidence/retry-grant-typecheck.log), [smoke](evidence/retry-grant-smoke.log).
- Static conformance: **91 pass, zero failures, seven untested cells**, unchanged in meaning. [Report](evidence/retry-grant-conformance.log).
- [Exact file hashes](evidence/retry-grant-checkpoint.json). Raw original logs remain in the local workspace; archived logs replace the home directory with `<USER_HOME>`.

Independent recheck of this fix is pending. Earlier native receipt `execution:871` is evidence for its earlier code bytes, not certification of this later change. The larger user outcome remains open; the user's limits challenge now requires a fresh scope classification and closure of feasible gaps. No publication occurred.
