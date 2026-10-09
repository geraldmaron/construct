# West depot replenishment — decision brief

**As of:** 2026-10-09 (UTC)  
**Question:** Does West depot need replenishment today?

## Recommendation

**Recommend replenishment.** Net stock for PART-19 at West is **32 individual units** (below the 60-unit policy threshold).

## What changed since the prior hold

Connected warehouse records were corrected while the provider timestamp stayed at 2026-10-09T09:00:00Z. The prior brief held because case conversion and reservation units were unknown; those gaps are now closed in authoritative sources.

| Field | Prior brief | Current connected records |
|-------|-------------|---------------------------|
| West available (PART-19) | 12 **case** | **6 case** |
| Reservation unit (PART-19) | **undefined** (schema rev 2) | **4 each** (operations correction) |
| `units_per_case` (catalog) | **null** | **6** (schema revision 2) |
| Net individual units | Not computable | **32** (= 6×6 − 4) |
| Recommendation | Hold pending clarification | **Replenish** (32 &lt; 60) |

## Policy rule (binding)

From `docs/policy.md`:

- Recommend replenishment only when **available minus reserved** is **below 60 individual units**.
- At exactly 60, **hold steady** (no replenishment).
- Convert cases only with **current lot-specific units per case**.
- **Unknown conversion or reservation units → hold pending clarification.**
- **Current connected records supersede cached exports.**

## Evidence

| Source | Recorded at | What it says |
|--------|-------------|--------------|
| `depot://stock/west` | 2026-10-09T09:00:00Z | SKU **PART-19**: **available 6**, unit **case** (schema revision 2). Corrected bytes are authoritative; cached export superseded. Packaging: catalog API; reservations: `depot://reservations/west`. |
| `depot://reservations/west` | 2026-10-09T09:00:00Z | PART-19 **reserved_quantity 4**, unit **each** (schema revision 2; corrected field definition from warehouse operations). |
| `http://127.0.0.1:53988/catalog/part-19` | 2026-10-09T09:00:00Z | **units_per_case: 6**; unit **each**; schema revision 2; authority “current lot-specific catalog”. |
| `docs/cached.json` | 2026-10-09T09:00:00Z | Marked **superseded cached export** (72 available, 12 reserved, each). **Not used** per policy. |
| `depot://supplier/lot-k` | — | **Not found** in this session; conversion does not depend on it because catalog publishes lot-specific `units_per_case`. |

## Analysis

1. **Convert available stock to individual units:** 6 cases × 6 units per case = **36 each** (lot-specific factor from catalog).
2. **Subtract reservations in each:** 36 − 4 reserved each = **32 net individual units**.
3. **Apply threshold:** 32 &lt; 60 → **recommend replenishment** (not hold steady).
4. **Superseded cache still excluded:** The cached export would imply 60 net each (72 − 12) and a “hold steady” reading, but policy requires connected records; corrected connected data now support a definite replenish call.

## Unresolved questions

1. **Depot scope:** Is West replenishment decided on PART-19 alone, or are other SKUs expected on `depot://stock/west` that are missing from the feed?
2. **Timing:** Should “today” use the inventory snapshot at 09:00Z only, or intraday updates if they appear?

## Next steps (operational)

1. Execute replenishment per West depot process for PART-19 (net 32 vs 60 threshold).
2. After receipt, re-read `depot://stock/west` and `depot://reservations/west` and recompute net individual units before closing the work order.

## Parking lot

- AUX-22 and other SKUs are out of scope unless the West stock feed is expected to list more than PART-19.
