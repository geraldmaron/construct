# West depot replenishment decision brief

**As of:** 2026-10-09 (local planning day)  
**Depot:** West  
**SKU in scope:** PART-19  
**Prepared for:** Same-day replenishment go / no-go

## Decision

**Hold — do not recommend replenishment today.**

The replenishment policy requires a net position in **individual units** (available minus reserved). Authoritative connected records do not allow that calculation without assumptions. Policy explicitly requires a hold when conversion or reservation units are unknown.

## Policy threshold (local)

From `docs/policy.md`:

- Recommend replenishment only when **available minus reserved** is **below 60 individual units**.
- At **exactly 60**, hold steady (no replenishment).
- Convert **cases** only using **current lot-specific units per case**.
- **Unknown conversion or reservation units** → hold pending clarification.
- **Current connected records supersede cached exports.**

## Evidence

### Current stock (`depot://stock/west`)

| Field | Value |
| --- | --- |
| SKU | PART-19 |
| Available | 12 |
| Unit | **case** |
| Record time | 2026-10-09T09:00:00Z |
| Authority | Marked current authoritative stock (schema revision 1) |

Stock is reported in cases, not individual units.

### Current reservations (`depot://reservations/west`)

| Field | Value |
| --- | --- |
| SKU | PART-19 |
| Reserved quantity | 4 |
| Unit | **Not stated** (schema revision 2) |

Operations text notes the legacy field was **each**, but warns not to assume the stock unit applies to reservations and to ask warehouse operations for the field definition.

### Packaging / conversion (`http://127.0.0.1:63156/catalog/part-19`)

| Field | Value |
| --- | --- |
| SKU | PART-19 |
| `units_per_case` | **null** |
| Catalog `unit` | each |
| Authority | Current lot-specific catalog (schema revision 1) |
| Related reference | `depot://supplier/lot-k` |

Without a non-null, lot-specific `units_per_case`, case on-hand cannot be converted to individual units under policy.

### Superseded cache (not used for decision)

`docs/cached.json` (observed 2026-10-09T09:00:00Z, status: superseded cached export) shows PART-19 at 72 available and 12 reserved in **each**, which would imply 60 net individual units (policy: hold steady). Policy directs use of connected records instead; connected stock (12 **cases**) and reservations (unit unclear) do not match that export. The cache is cited only to show why a quick file read would be misleading.

### Inaccessible source

`depot://supplier/lot-k` (referenced from the packaging catalog) returned **permission_denied** for this session principal. Lot-specific case size may live there; it was not read.

## Reasoning

1. **Net position unknown:** Available is 12 cases; reserved is 4 with undefined unit. No defensible `(available − reserved)` in individual units.
2. **Conversion blocked:** `units_per_case` is null in the current catalog response; policy forbids guessing case conversion.
3. **No replenishment trigger:** Even if reservations were 4 cases (worst case among same-unit interpretations), individual-unit net still depends on case size, which is missing.
4. **Conservative default:** Policy’s hold rule applies before any replenishment recommendation.

## Unresolved questions

1. **What unit does `reserved_quantity` use for PART-19 on West** in the current operations schema (each vs case vs other)?
2. **What is the lot-specific `units_per_case` for the on-hand lot** (catalog points to lot-k; supplier lot record was not readable here)?
3. **Are there other SKUs or reservations at West** that should be rolled into a depot-wide replenishment decision, or is PART-19 the sole driver today?
4. **Should replenishment consider in-transit or inbound** not reflected in `depot://stock/west`?

## Suggested next steps (information only — no orders authorized)

1. Warehouse operations: confirm reservation unit for PART-19 at West.
2. Obtain current lot packaging (lot-k or equivalent) with a populated `units_per_case`.
3. Recompute net individual units; apply the 60-unit rule; then decide replenish vs hold steady.

## Source index

| URI / path | Role |
| --- | --- |
| `depot://stock/west` | Authoritative on-hand |
| `depot://reservations/west` | Authoritative reservations |
| `docs/policy.md` | Replenishment rule |
| `http://127.0.0.1:63156/catalog/part-19` | Case conversion |
| `docs/cached.json` | Superseded; not decision basis |
| `depot://supplier/lot-k` | Not accessed (permission denied) |
