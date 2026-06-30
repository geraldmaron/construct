<!--
tests/audit/README.md — namespace + run contract for the 2026-06-30 audit red fixtures.

Fixtures are *.red.mjs (not *.test.mjs) so the recursive test runner skips them during
the red phase; they run only when passed explicitly to node --test. Each is renamed to
*.test.mjs when its fix lands, promoting it into the gate. Index: REMEDIATION-PLAN.md.
-->

# Audit red-fixture namespace

Failing fixtures proving the F01-F14 defects from the 2026-06-30 full-project audit.
Files are named `*.red.mjs` (NOT `*.test.mjs`) so they stay out of the auto-discovered
`npm test` suite during the red phase. Run one with:

    node --test tests/audit/<family>/<name>.red.mjs

When the corresponding fix lands, the fixture is renamed to `*.test.mjs` to wire it into the gate.
