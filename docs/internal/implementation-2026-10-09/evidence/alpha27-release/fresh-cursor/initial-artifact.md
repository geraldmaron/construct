# West depot replenishment decision brief

**As of:** 2026-10-09 (UTC)  
**Question:** Does West depot need replenishment today?  
**Decision (policy-aligned):** **Hold** — do not recommend replenishment or a release from hold until net available stock can be expressed in individual units.

## Recommendation

Under `docs/policy.md`, replenishment is recommended only when **available minus reserved** stock is **below 60 individual units** (at exactly 60, hold steady). Unknown case conversion or reservation units require a **hold pending clarification**.

Connected records show PART-19 at West with **12 cases** available and **4** reserved, but the path to individual units is blocked: packaging catalog reports `units_per_case` as null, the lot-specific record (`depot://supplier/lot-k`) was not readable with current access, and the reservation row does not state a unit. **No defensible comparison to the 60-unit threshold is available today.**

This brief does not authorize placing orders, changing reservations, or contacting suppliers.

## Evidence

| Fact | Source | Record time (UTC) |
|------|--------|-------------------|
| PART-19 available quantity **12**, unit **case** | `depot://stock/west` | 2026-10-09T09:00:00Z |
| PART-19 `reserved_quantity` **4**; schema does not state unit; legacy field was each | `depot://reservations/west` | 2026-10-09T09:00:00Z |
| `units_per_case` **null** for PART-19; references lot record | `http://127.0.0.1:62262/catalog/part-19` | 2026-10-09T09:00:00Z |
| Threshold: replenish when net available &lt; **60** individual units; unknown units → hold | `docs/policy.md` | (project policy) |

Stock text states connected records supersede cached exports; reads above are from the connected inventory and operations sources observed 2026-10-09.

## Quantities and policy test

**Inputs (grounded):**

- Available: 12 cases (`depot://stock/west`)
- Reserved: 4 (`depot://reservations/west`; unit not declared in current schema)
- Policy floor: 60 individual units (`docs/policy.md`)

**Unavailable calculation:**  
Net available individual units = (available in individual units) − (reserved in individual units).

- Cases cannot be converted without **current lot-specific units per case** (`docs/policy.md`). Catalog shows `units_per_case` null; lot reference `depot://supplier/lot-k` returned **permission_denied** on fetch.
- Reserved quantity cannot be subtracted without a defined reservation unit; operations text explicitly says not to assume the stock unit applies to reservations.

**Boundary rule:** Replenish only if net &lt; 60; hold at exactly 60; hold when units are unknown. Today the comparison itself is undefined, so the policy-mandated outcome is **hold**, not “above threshold” or “below threshold.”

## Source tension

- **Stock** records PART-19 in **cases**.
- **Packaging catalog** lists `unit` as each while stock is in cases, and does not supply a case multiplier (`units_per_case` null).

Treat these as a conversion gap, not as permission to pick a convenient unit.

## Hypotheses considered

| Hypothesis | What would refute it | Status |
|------------|----------------------|--------|
| West is above the 60-unit floor and does not need replenishment | Lot-specific units per case plus reservation unit yielding net ≥ 60 individual units | Not testable with held data |
| West is below the floor and needs replenishment today | Same conversion, yielding net &lt; 60 | Not testable with held data |
| Policy requires hold regardless of apparent stock | Only if reservation and case units were clarified and net could be computed | Partially supported: unknown units trigger hold now |

## Unresolved questions

1. What is **units per case** for the current PART-19 lot (`depot://supplier/lot-k`)? *(Requires access the current principal does not have.)*
2. What **unit** applies to `reserved_quantity` 4 for PART-19 in the schema revision 2 operations feed? *(Operations text directs asking warehouse operations.)*
3. After both are known, what is **net available individual units**, and how far from the **60**-unit boundary?

## Strongest objection

Someone may treat legacy “each” on reservations and a casual case pack assumption to conclude stock is ample. That would violate written policy (unknown units → hold) and the reservations record (do not assume stock unit describes reservations).

## Evidence limits

- Only PART-19 at West was in scope for this brief; AUX-22 appears on reservations but was not part of the replenishment test described in policy pointers.
- Supplier lot content was not observed; no cached export was used in place of connected stock/reservations.

## Confidence

**High** that policy requires **hold** given missing conversion and reservation units. **No confidence** on whether replenishment would be warranted after clarification.
