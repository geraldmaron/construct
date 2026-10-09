# West depot replenishment — decision brief

**As-of:** 2026-10-09 (records stamped 09:00 UTC; re-fetched 21:03 UTC after warehouse corrections)  
**Question:** Does West depot need replenishment today?

## Decision

**Recommend replenishment today.**

Net available individual units for `PART-19` at West are **32**, which is **below** the 60-unit policy threshold. Corrected stock, reservation units, and lot-specific conversion are all present in connected records, so the hold no longer applies.

## What changed since the prior brief

The prior brief (same calendar day, earlier fetch) called a **hold** because conversion and reservation units were unknown. Warehouse corrections and a fresh read of connected sources changed the inputs as follows:

| Input | Prior brief | Current (corrected) |
| --- | --- | --- |
| On-hand `PART-19` at West | Superseded case count (prior ambiguous read) | **6 case** |
| Reservation unit for `PART-19` | **Not stated** (schema revision 2) | **each** (authoritative operations correction) |
| `units_per_case` (catalog API) | **null** (schema revision 1) | **6** (schema revision 2) |
| Net individuals (computable?) | No — policy hold | Yes — **32** |
| Decision | Hold | **Recommend replenishment** |
| `depot://supplier/lot-k` | Permission denied | **Not found** (not used; API supplies conversion) |

Provider timestamp on inventory/operations rows remains `2026-10-09T09:00:00Z`; corrected field values supersede the earlier ambiguous or null payloads per connected-record policy.

## Policy threshold (local)

From `docs/policy.md`:

- Recommend replenishment only when **available minus reserved** is **below 60 individual units**.
- At **exactly 60**, hold steady (no replenishment).
- Convert cases only with **current lot-specific units per case**.
- **Unknown conversion or reservation units → hold** pending clarification.
- **Current connected records supersede cached exports.**

## Evidence

### Current stock (`depot://stock/west`, inventory)

| Field | Value |
| --- | --- |
| SKU | PART-19 |
| Available | **6** |
| Unit | **case** |
| Schema revision | **2** |
| Updated | 2026-10-09T09:00:00Z |

Packaging metadata: `http://127.0.0.1:51700/catalog/part-19` (per stock record). Inventory search returned only this West SKU for `PART-19`.

### Reservations (`depot://reservations/west`, operations)

| Field | Value |
| --- | --- |
| SKU | PART-19 |
| Reserved quantity | 4 |
| Unit | **each** (corrected authoritative field; supersedes ambiguous prior response) |
| Schema revision | 2 |
| Updated | 2026-10-09T09:00:00Z |

### Lot-specific conversion (packaging API via workspace fetch)

Fetched `http://127.0.0.1:51700/catalog/part-19` (successful response):

| Field | Value |
| --- | --- |
| SKU | PART-19 |
| `units_per_case` | **6** |
| `unit` | each |
| Schema revision | **2** |
| Authority | current lot-specific catalog |

Catalog index (`depot://catalog/part-19`) still defers conversion to this API; the index is not the conversion factor.

### Supplier lot detail

`depot://supplier/lot-k` — **not found** for this principal. Conversion is taken from the connected catalog API above, which reports complete coverage.

### Informal context (non-authoritative)

`depot://chat/staffing` is unchanged in role: operator chatter about “six each” does **not** replace connected catalog data. With `units_per_case` now published as 6 on the API, informal notes are consistent but not evidentiary.

## Analysis

1. **Convert on-hand to individuals:** 6 case × 6 each per case = **36** individual units on hand (lot-specific factor from catalog API).
2. **Subtract reservations in each:** reserved 4 **each** → net **36 − 4 = 32** individual units available after reservations.
3. **Apply threshold:** 32 is **below** 60 → **recommend replenishment** per `docs/policy.md`.
4. **Not at steady-state:** At exactly 60 the policy would call for holding steady; 32 is not in that band.

## Suggested next steps (information only — no orders authorized)

1. Operations: initiate replenishment per local West depot procedures for `PART-19`.
2. After receipt, re-run net position against the 60-unit threshold.
3. Keep catalog API `units_per_case` aligned with the active lot if packaging changes.

## Source URIs cited

- `depot://stock/west`
- `depot://reservations/west`
- `depot://catalog/part-19`
- `http://127.0.0.1:51700/catalog/part-19`
- `depot://supplier/lot-k` (not found)
- `docs/policy.md`
