# Active Session Context — 2026-07-18 (final push + teardown)

## Task
Drive construct-b0nny (Workspace Control Plane) to COMPLETION, then leave the machine pristine:
Construct installed nowhere but this project source, zero Construct processes, nothing auto-
spawning, no LibreOffice — "as if we haven't started it yet." (Gerald directive, this session.)

## LANDED + PUSHED (feat/workspace-control-plane @ 97d7d25a, on origin)
Wave 3 (5 beads) committed, merged, integrated-verified (5295 unit tests / 0 fail; 5 beads'
functional 43/43; audit-ratchet GREEN after baselining 10 pre-existing intentional findings;
doctor 58 passed / 1 pre-existing failure = cross-surface adapter parity drift), pushed, closed:
- .18 Worker Profiles (9c5c472c) · .23 work-spec planning (67b5a89e) · .25 workplace loop
  (3b0d9125, equivalence gate green) · .26 shared server (146c4391, live PG+Docker) · .29 legacy
  daemon rip-out (b9a5fb19, sweeper in postinstall+doctor).
Epic 26/29 (89%). bd dolt push done for the closes (NOT for the 2 follow-ups below — Gerald
rejected that dolt push; redo bd persistence carefully at end).
Merge-conflict lesson RE-CONFIRMED: blind marker-strip broke bin/construct + cli-commands
(shared trailing context after >>>>>>>); ALWAYS node --check code files after resolving.

## IN FLIGHT — wave 4 (final feature beads), Opus agents
- .17 (wcp-m3b-oracle-delete): Oracle daemon DELETE + cutover. Point-of-no-return. .29 already
  deleted oracle-liveness + stopped spawn; .25 provides E5 executor w/ green equivalence. Remaining:
  cut oracle/execute.mjs directive-due -> E5 executor, re-home reconcile to E1, migrate
  .construct/oracle/ state (script+test), delete daemon-entry.mjs, prove 4 gating conditions.
- .27 (wcp-e8-beads-projection): bd as projection of E1/E3 model. Design-first, field-authority
  table, drift-detecting reconciliation, raw-record-preserving importers, validate vs own bd history.
- .28 (final cutover) still blocked on .17+.27. When reached: verify all deletions, freeze legacy,
  package, prove rollback. DO NOT npm-publish / external-release without explicit Gerald approval.

## Follow-ups filed (under epic, not yet dolt-pushed)
- Delete dead lib/roles/router.mjs (0 prod importers) + refine 03c legacy-import finder over-match.
- Validate workplace-loop detection vs a real source w/ qualifying signals (.25 honest gap).

## FINAL TEARDOWN (do LAST, after all bead work — tests create temp installs):
1. Kill ALL construct node processes (daemons, servers, MCP, test runners). 0 daemons now (.29 fix
   active in primary checkout).
2. Remove temp global installs: /private/var/folders/**/construct-global-*, construct-degradation-*,
   construct-global-tgz-*, construct-*.
3. Uninstall any global @geraldmaron/construct (npm -g) + ~/.construct/launcher install.
4. Clean ~/.construct (projects/ leaked keys, runtime/, heartbeats) — "haven't started it" state.
5. Kill any soffice/libreoffice.
6. Remove wave-4 worktrees + branches after merge.
7. Verify: no construct processes, no global installs, clean ~/.construct.
