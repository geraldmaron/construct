# West depot replenishment — decision brief

**As of:** 2026-10-09 (UTC)  
**SKU in scope:** PART-19 (West depot)

## Decision

**Recommend replenishment today.**

Connected records now support a full conversion to individual units. Net available is **32 each**, which is **below** the 60-unit replenishment threshold.

## What changed since the prior brief

Warehouse operations issued **corrected authoritative bytes** on the same provider timestamps (`2026-10-09T09:00:00Z`). The prior recommendation was **hold** because net stock in individuals could not be computed; that is no longer true.

| Area | Prior (blocked) | Current (corrected) |
|------|-----------------|---------------------|
| West stock (`depot://stock/west`) | 12 **case**, schema revision 1 | **6 case**, schema revision **2** (corrected bytes) |
| Reservations (`depot://reservations/west`) | `reserved_quantity` 4 with **no unit** in schema revision 2 | **4 each** — explicit corrected field definition |
| Packaging API (`/catalog/part-19`) | `units_per_case`: **null**, schema revision 1 | **`units_per_case`: 6**, schema revision **2**; coverage complete |
| Supplier lot (`depot://supplier/lot-k`) | Permission denied; conversion blocked | Not required — catalog is lot-specific and complete |
| Recommendation | **Hold** (unknown `net_individual`) | **Replenish** (`net_individual` = 32 < 60) |

`docs/cached.json` remains a superseded export (72 available, 12 reserved, each) and still must not drive the decision.

## Policy rule (local)

From `docs/policy.md`:

- Recommend replenishment only when **available minus reserved** is **below 60 individual units**.
- At **exactly 60**, hold steady (no replenishment).
- Convert cases only with **current lot-specific units per case**.
- Unknown conversion or reservation units → **hold pending clarification**.
- **Current connected records supersede cached exports.**

## Calculation

```
available_individual = 6 case × 6 each/case = 36 each
reserved_individual  = 4 each
net_individual       = 36 − 4 = 32 each
```

**32 < 60** → recommend replenishment.

## Evidence

| Source | Observed | Key facts |
|--------|----------|-----------|
| `depot://stock/west` (inventory, 2026-10-09T09:00:00Z) | Workspace MCP fetch | PART-19 **available 6**, stock unit **case**, schema revision **2**. Corrected bytes authoritative; points to packaging API and reservations. |
| `depot://reservations/west` (operations, 2026-10-09T09:00:00Z) | Workspace MCP fetch | PART-19 **reserved_quantity 4**, unit **each** (corrected schema revision 2 definition). |
| `http://127.0.0.1:52938/catalog/part-19` (packaging API) | Workspace MCP fetch | **`units_per_case`: 6**; `unit`: `each`; schema revision **2**; coverage complete. |
| `docs/cached.json` | Project file | Superseded export: 72 available, 12 reserved, unit **each**. **Must not drive today’s decision** per policy. |

## Remaining checks (non-blocking)

1. **Single-SKU scope:** West stock fetch only surfaced PART-19. Confirm whether other SKUs at West require separate replenishment review today.
2. **Operational sign-off:** This brief is analysis only; warehouse or procurement should confirm before placing an order (see authorization boundary).

## Authorization boundary

This brief is analysis only. README states no order placement or production action is authorized from this project.
