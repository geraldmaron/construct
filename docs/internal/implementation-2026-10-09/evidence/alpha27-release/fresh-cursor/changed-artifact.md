# West depot replenishment decision brief

**As of:** 2026-10-09 (UTC)  
**Question:** Does West depot need replenishment today?  
**Decision (policy-aligned):** **Recommend replenishment** — net available stock is **32 individual units**, below the **60**-unit floor.

## What changed since the prior brief

Connected warehouse records were corrected on the authoritative feeds (provider timestamps unchanged; corrected field values supersede earlier reads and cached exports).

| Area | Prior read | Current read |
|------|------------|--------------|
| PART-19 available at West | **12** cases | **6** cases (`depot://stock/west`) |
| Reservation unit for PART-19 | Not declared in schema (legacy ambiguity) | **4** reserved, unit **each** (`depot://reservations/west`, schema revision 2) |
| `units_per_case` for PART-19 | **null** in catalog | **6** (`http://127.0.0.1:62262/catalog/part-19`, schema revision 2) |
| Lot record `depot://supplier/lot-k` | `permission_denied` | **not_found** (no additional conversion factor observed) |
| Policy outcome | **Hold** (conversion and reservation units unknown) | **Replenish** (net computable; see below) |

The superseded cached export in `docs/cached.json` still shows 72 each available and 12 reserved; policy and stock text require ignoring it in favor of connected stock and reservations.

## Recommendation

Under `docs/policy.md`, replenishment is recommended when **available minus reserved** stock is **below 60 individual units** (at exactly 60, hold steady).

With current authoritative data:

- Available: **6** cases × **6** units per case = **36** individual units (catalog conversion applied per policy).
- Reserved: **4** individual units (**each**).
- **Net available: 32 individual units.**

**32 &lt; 60**, so replenishment is recommended today. This is a planning recommendation only; it does not authorize placing orders, changing reservations, or contacting suppliers without your usual approvals.

## Evidence

| Fact | Source | Record time (UTC) |
|------|--------|-------------------|
| PART-19 available quantity **6**, unit **case** | `depot://stock/west` | 2026-10-09T09:00:00Z |
| PART-19 `reserved_quantity` **4**, unit **each** (schema revision 2) | `depot://reservations/west` | 2026-10-09T09:00:00Z |
| `units_per_case` **6** for PART-19 | `http://127.0.0.1:62262/catalog/part-19` | 2026-10-09T09:00:00Z |
| Threshold: replenish when net available &lt; **60** individual units | `docs/policy.md` | (project policy) |
| Cached export **superseded** (72 each / 12 reserved) | `docs/cached.json` | 2026-10-09T09:00:00Z |

Stock and reservations state that corrected connected records supersede cached exports. Reads above are from connected inventory, operations, and catalog sources observed 2026-10-09.

## Quantities and policy test

**Inputs (grounded):**

- Available: 6 cases (`depot://stock/west`)
- Units per case: 6 (`http://127.0.0.1:62262/catalog/part-19`)
- Reserved: 4 each (`depot://reservations/west`)
- Policy floor: 60 individual units (`docs/policy.md`)

**Calculation:**

Net available individual units = (6 × 6) − 4 = **32**.

**Boundary rule:** Replenish when net &lt; 60; hold at exactly 60. **32** is below the floor, so the policy-mandated outcome is **recommend replenishment**.

## Source tension

- **Stock** records PART-19 in **cases**; **reservations** record PART-19 in **each** — now explicit in schema revision 2, so subtraction in individual units is allowed.
- **Catalog** `unit` is **each** while stock is in **cases**; `units_per_case` **6** closes the gap for conversion.
- **Cached export** disagrees materially (72 each net story) with connected stock (6 cases). Policy requires treating connected records as authoritative.

## Hypotheses considered

| Hypothesis | What would refute it | Status |
|------------|----------------------|--------|
| West is below the 60-unit floor and needs replenishment today | Net individual units ≥ 60 | **Supported** — net is 32 |
| West is above the floor and does not need replenishment | Net &lt; 60 | **Refuted** — net is 32 |
| Unknown units still require hold | Reservation and case conversion both stated in current feeds | **Refuted** for today’s reads |
| Cached export should drive the decision | Connected stock/reservations text and policy | **Refuted** |

## Unresolved questions

1. Confirm operational acceptance that catalog `units_per_case` **6** is the correct lot-specific multiplier for the **6** cases on hand (lot URI `depot://supplier/lot-k` is **not_found**; conversion rests on catalog revision 2).
2. Whether any other SKUs at West (e.g. AUX-22 on reservations) need the same replenishment pass — this brief only tests PART-19 per prior scope.

## Strongest objection

Someone may cite the superseded cached export (72 each available) to argue stock is ample. That conflicts with corrected `depot://stock/west` (**6** cases) and written policy that connected records win. Acting on the cache would overstate on-hand quantity by a large margin relative to the authoritative case count.

## Evidence limits

- Only PART-19 at West was in scope for the replenishment test described in policy pointers.
- Supplier lot document was not observed (`depot://supplier/lot-k` not found); conversion uses catalog `units_per_case` only.

## Confidence

**High** that policy, given current connected records, yields **recommend replenishment** (net **32** &lt; **60**). **Moderate** on catalog-to-lot alignment until lot record or operations confirms the same pack size for the physical cases on hand.
