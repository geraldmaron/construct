# West depot replenishment — decision brief

**As of:** 2026-10-09 (UTC)  
**SKU in scope:** PART-19 (West depot)

## Decision

**Hold — do not recommend replenishment today.**

Net available stock in **individual units** cannot be calculated from current connected records. Local replenishment policy requires a hold when case conversion or reservation units are unknown. Until warehouse operations confirms those units, any replenish / do-not-replenish call would be speculative.

## Policy rule (local)

From `docs/policy.md`:

- Recommend replenishment only when **available minus reserved** is **below 60 individual units**.
- At **exactly 60**, hold steady (no replenishment).
- Convert cases only with **current lot-specific units per case**.
- Unknown conversion or reservation units → **hold pending clarification**.
- **Current connected records supersede cached exports.**

## Evidence

| Source | Observed | Key facts |
|--------|----------|-----------|
| `depot://stock/west` (inventory, 2026-10-09T09:00:00Z) | Workspace MCP fetch | PART-19 **available 12**, stock unit **case** (schema revision 1). Points to packaging API and `depot://reservations/west`. |
| `depot://reservations/west` (operations, 2026-10-09T09:00:00Z) | Workspace MCP fetch | PART-19 **reserved_quantity 4**. Legacy field was **each**; schema revision 2 **does not state a unit**. Instructions: do not assume stock unit applies to reservations. |
| `http://127.0.0.1:52938/catalog/part-19` (packaging API) | Workspace MCP fetch | **`units_per_case`: null**; `unit`: `each`; schema revision 1; references `depot://supplier/lot-k`. |
| `depot://supplier/lot-k` | Workspace MCP fetch | **Permission denied** — lot-specific conversion not readable by this principal. |
| `docs/cached.json` | Project file | Superseded export: 72 available, 12 reserved, unit **each** (net 60 each if treated as authoritative). **Must not drive today’s decision** per policy. |

### Why the threshold was not applied

The replenishment threshold operates on **individual units**:

```
net_individual = available_individual − reserved_individual
```

Today’s blockers:

1. **Stock is reported in cases (12)** but the catalog API returns **`units_per_case: null`**, so cases cannot be converted to individuals without violating policy.
2. **Reservations (4)** have no declared unit in the current schema; assuming “each” (or “case”) would contradict the operations record.

Without both conversions, **net_individual is unknown**, so the comparison to 60 cannot be made.

### Note on superseded cache (not used)

If one ignored policy and treated `docs/cached.json` as current, net would be 72 − 12 = **60 each**, which would imply **hold steady** (not replenish). That figure conflicts with live stock (12 **cases**) and is explicitly superseded; it is listed only to explain why a stale export might suggest a false sense of clarity.

## Unresolved questions (blocking)

1. **Reservation unit for PART-19 at West:** Is `reserved_quantity: 4` in **each**, **case**, or another unit? (Operations record defers to warehouse ops; legacy “each” is not authoritative under schema revision 2.)
2. **Lot-specific case pack for PART-19:** What is `units_per_case` for the active lot? The connected catalog returns `null`; supplier lot detail (`depot://supplier/lot-k`) was not accessible here.
3. **Single-SKU scope:** West stock fetch only surfaced PART-19. Confirm whether other SKUs at West require separate replenishment review today.

## Recommended next steps

1. Ask warehouse operations to confirm reservation field units for PART-19 (schema revision 2).
2. Obtain current lot `units_per_case` (authorized read on supplier lot or manual confirmation).
3. Recompute `net_individual` and re-run the 60-unit rule; only then issue a replenish or hold-steady recommendation.

## Authorization boundary

This brief is analysis only. README states no order placement or production action is authorized from this project.
