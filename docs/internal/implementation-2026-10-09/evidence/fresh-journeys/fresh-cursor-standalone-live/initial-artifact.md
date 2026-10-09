# West depot replenishment decision brief

**As of:** 2026-10-09 (UTC), end of day  
**Question:** Does West depot need replenishment today?  
**Decision:** **No replenishment order today** — policy requires a **hold** until net available stock can be expressed in individual units.

---

## Bottom line

Under `docs/policy.md`, replenishment is recommended only when **available minus reserved** is **strictly below 60 individual units**. At exactly 60, hold steady. When case conversion or reservation units are unknown, **hold pending clarification**.

Today’s connected records show PART-19 at West with **12 available (cases)** and **4 reserved (unit not declared)**. The catalog reports **`units_per_case`: null** for PART-19, so case stock cannot be converted to individual units. The net position against the 60-unit threshold is **undefined**, not demonstrably below 60. **Do not replenish on incomplete math.**

---

## Evidence

| Source | Class | What it says (material) |
|--------|--------|-------------------------|
| `docs/policy.md` | Policy | Threshold 60 individual units (net); unknown conversion/reservation units → hold; connected records supersede cached exports |
| `depot://stock/west` | Record (inventory) | PART-19: **12 available**, unit **case** (updated 2026-10-09T09:00:00Z) |
| `depot://reservations/west` | Record (operations) | PART-19: **reserved_quantity 4**; schema rev 2 **does not state unit**; legacy field was each — do not assume stock unit applies |
| `http://127.0.0.1:58677/catalog/part-19` | Record (catalog) | **`units_per_case`: null**; references `depot://supplier/lot-k` for lot-specific packaging |
| `docs/cached.json` | **Superseded** export | PART-19: 72 each available, 12 each reserved (net **60 each** if treated as current) — **must not drive today’s decision** |

### Superseded cache (not used)

The cached export would imply **72 − 12 = 60** individual units (hold-steady at the policy boundary). Policy explicitly requires **connected depot records** over this file. Live stock is recorded in **cases**, not eaches, so the cache and live figures **conflict**; only live connected data governs.

### Inaccessible reference

`depot://supplier/lot-k` (lot packaging) returned **permission_denied** for this session. That record could supply `units_per_case` when catalog is null; it was **not** read.

---

## Policy application

| Step | Status |
|------|--------|
| Express available in individual units | **Blocked** — stock is in cases; `units_per_case` is null |
| Express reserved in individual units | **Blocked** — reservation unit not in schema rev 2 |
| Compute net (available − reserved) | **Not calculable** |
| Compare net to 60 | **Not performed** |
| Mandatory hold on unknown units | **Applies** |

**Replenish today?** No — not because net is proven above 60, but because **the comparison is not yet valid**.

---

## Alternative readings (disconfirmation)

| Hypothesis | If true… | Evidence |
|------------|-----------|----------|
| Reservations are still in **each** (legacy) | Net depends on converting 12 cases to eaches | Reservations text warns against assuming; unit unstated in current schema |
| **12 cases** × known pack size ≫ 60 | Might be hold-steady without replenishment | Pack size unknown (`units_per_case` null) |
| **Cached 60 each** is still authoritative | Hold-steady, no replenishment | Policy and stock record mark cache superseded; live unit is case |

None of these alternatives justify a **replenishment** recommendation without clarified units and conversion.

---

## Adversarial review (summary)

**VERDICT: Accepted with controls** — the hold conclusion aligns with policy; controls are: do not use superseded cache; do not infer reservation units from stock units; resolve packaging before interpreting case counts.

---

## Unresolved questions

1. **What unit does `reserved_quantity` use for PART-19 at West in operations schema revision 2?** (Warehouse operations field definition.)
2. **What is `units_per_case` for the active lot?** (Catalog is null; `depot://supplier/lot-k` was not readable with current access.)
3. **Does replenishment planning for West today depend on SKUs other than PART-19?** This brief only traced PART-19 from connected West stock and reservations.

---

## What would change the decision

After **units_per_case** and **reservation unit** are confirmed:

1. Convert **12 cases** to individual available units (lot-specific conversion only).
2. Express **4 reserved** in the same individual unit.
3. Compute **net = available − reserved**.
4. If net **&lt; 60** → recommend replenishment; if net **= 60** → hold steady; if net **&gt; 60** → no replenishment for threshold purposes.

Until then, **hold** is the supported operational stance for today.
