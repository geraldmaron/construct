# Focused experimental-alpha policy review

The separate policy and publication were explicitly approved by Gerald on
2026-10-10 after the former full-matrix blocker and proposed scope were stated.
The focused reviewer task `experimental_policy_review` changed no files and
launched no models. It ran six deterministic policy tests and adversarial
in-memory checks.

Three findings were fixed before native execution: the candidate identity now
includes both imported fixture helpers; persisted before/after deliverables
must retain exact ID, run, step, body and draft trust; starting a new native
attempt archives the previous manifest and atomically makes it ineligible,
so failure or interruption cannot fall back to an earlier success.

The recheck approved the policy, conditional on actual bounded controls and
final code/CI gates. The qualified default still requires the original full
matrix. CI retains lint, types, all tests, packaged smoke, main ancestry,
version agreement, OIDC provenance and alpha-only publishing. No remaining
focused policy blocker was found. This is not product or cross-host
qualification and is not cryptographic attestation against local authors.
