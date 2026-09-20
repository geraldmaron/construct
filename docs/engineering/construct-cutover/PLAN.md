# Bootstrap plan

One plan until the native ledger owns work. After import this file is
historical; status lives in the ledger.

## Slice 1 — capture and truth

- [x] Freeze mandate, baseline, findings, architecture
- [x] Inspect checkout vs audit commit (identical HEAD)
- [x] Do not add tracker items

## Slice 2 — trusted execution

- [x] verification_result, review_complete, plan_complete
- [x] lease budget, cancel persistence, frozen bindings, session identity
- [x] capability inventory without invented unscoped writes

## Slice 3 — project understanding

- [x] Convention discovery, provenance, coverage, containment
- [x] Source refresh → claims; content vs inventory digest
- [x] project_context filter-then-page

## Slice 4 — native work and migration

- [x] Ledger + CLI + MCP `work`
- [x] Legacy JSONL importer, export/restore
- [x] Live backend snapshot, isolated restore test, project import
- [x] Import this bootstrap plan into the ledger (follow-through item `work-8d827222`)

## Slice 5 — simplify

- [x] AGENTS.md / CLAUDE.md native contract
- [x] Stop operational Beads hooks/reconcile as the writer
- [x] Registry/docs regeneration
- [ ] Remaining dead-code deletion after gates (historical reconcile reader retained for citation lint)

## Slice 6 — prove

- [x] Full gate on Node >= 22.18
- [x] Packaged smoke including work
- [x] Honest remaining limitations recorded
- [ ] Signed commit + push of `staging` (blocked on 1Password SSH signing from this Cursor session)

Acceptance for each executable item: tests or a recorded command; no
silent skip of malformed import rows.
