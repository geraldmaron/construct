# West depot replenishment decision brief

**As of:** 2026-10-09 (UTC), end of day  
**Question:** Does West depot need replenishment today?  
**Decision:** **Recommend replenishment for threshold purposes** — net available stock is **32 individual units**, strictly below the **60**-unit policy line. (This is a planning recommendation only; placing orders is not authorized in this workspace.)

---

## What changed since the prior brief

Warehouse operations corrected connected records (provider `updatedAt` on stock may still read 2026-10-09T09:00:00Z; the stock text states **corrected bytes are authoritative**). Against the earlier hold conclusion:

| Topic | Prior brief (pre-correction) | Current connected sources |
|--------|------------------------------|---------------------------|
| Available stock | 12 **cases** | **6 cases** |
| Reservation unit | Not declared in schema rev 2 | **4 each** (explicit in corrected operations record) |
| `units_per_case` | **null** in catalog | **6** (catalog schema revision 2) |
| Net vs 60 | **Not calculable** → mandatory hold | **32 each** → below threshold |
| Decision | Hold pending clarification | **Recommend replenishment** (threshold trigger) |

---

## Bottom line

Under `docs/policy.md`, replenishment is recommended when **available minus reserved** is **strictly below 60 individual units**. At exactly 60, hold steady.

Today’s connected records for PART-19 at West:

1. **6 cases** available (`depot://stock/west`, schema revision 2).
2. **4** reserved in **individual units** (`depot://reservations/west`, schema revision 2 — corrected field definition).
3. Lot-specific conversion **6 units per case** (`http://127.0.0.1:58677/catalog/part-19`, schema revision 2).

**Available in individual units:** 6 × 6 = **36 each**  
**Net:** 36 − 4 = **32 each**  
**32 &lt; 60** → **recommend replenishment** for policy threshold purposes (not a computed order quantity).

---

## Evidence

| Source | Class | What it says (material) |
|--------|--------|-------------------------|
| `docs/policy.md` | Policy | Threshold 60 individual units (net); lot-specific case conversion; connected records supersede cached exports |
| `depot://stock/west` | Record (inventory) | PART-19: **6 available**, unit **case**; **corrected bytes are authoritative** (schema revision 2) |
| `depot://reservations/west` | Record (operations) | PART-19: **reserved_quantity 4**, unit **each** — corrected authoritative definition (schema revision 2) |
| `http://127.0.0.1:58677/catalog/part-19` | Record (catalog) | **`units_per_case`: 6**; `unit`: each (schema revision 2) |
| `docs/cached.json` | **Superseded** export | 72 each available, 12 each reserved — **must not drive today’s decision** |

### Superseded cache (not used)

The cached export would imply **72 − 12 = 60** individual units (hold-steady at the boundary). Policy requires **connected depot records** over this file. Live stock is **6 cases** with explicit conversion and reservation units, so the cache **conflicts** with governing records.

---

## Policy application

| Step | Status |
|------|--------|
| Express available in individual units | **Done** — 6 cases × 6 each/case = 36 each |
| Express reserved in individual units | **Done** — 4 each |
| Compute net (available − reserved) | **32 each** |
| Compare net to 60 | **32 &lt; 60** |
| Mandatory hold on unknown units | **Does not apply** (units and conversion are stated) |

**Replenish today (threshold)?** **Yes** — net is demonstrably below 60. Operational order sizing and authorization sit outside this brief.

---

## Alternative readings (disconfirmation)

| Hypothesis | If true… | Evidence |
|------------|-----------|----------|
| **Cached 60 each** is still authoritative | Hold-steady, no replenishment | Policy and stock record mark cache superseded; live records differ |
| Reservations are still in **cases** | Net would be higher | Operations record states **unit each** after correction |
| **12 cases** remain on hand | Net might still be below 60 depending on conversion | Stock record now states **6** cases (corrected bytes) |
| Informal rule “all cases are six each” overrides catalog | Could justify conversion without API | `depot://chat/staffing` is not authoritative; catalog supplies **6** for current lot |

None of these alternatives support **holding** at the current connected numbers; the strongest rival to replenishment is **scope** (other SKUs not reviewed), not PART-19 math.

---

## Adversarial review (summary)

**VERDICT: Accepted with controls** — replenishment follows from corrected stock, reservation, and catalog records. Controls: **PART-19-only** scope; **do not** use superseded cache; **refresh catalog** if the active lot changes; treat output as a **threshold trigger**, not an order quantity.

---

## Unresolved questions

1. **Does replenishment planning for West today depend on SKUs other than PART-19?** This brief only traced PART-19 from connected West stock and reservations.

---

## What would change the decision

- **Net rises to 60 or above** (e.g., stock correction, reservation release, or lot conversion change) → hold steady or no threshold replenishment.
- **Catalog `units_per_case` changes** for the active lot → recompute net before acting.
- **Connected records superseded again** → re-read `depot://stock/west` and `depot://reservations/west` before relying on this brief.
