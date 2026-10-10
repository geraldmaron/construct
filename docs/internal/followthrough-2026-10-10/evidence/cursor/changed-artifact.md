# West depot replenishment decision brief

**As of:** 2026-10-10 (UTC), end of day  
**Scope:** West depot, SKU PART-19 (only SKU on connected West stock)  
**Question:** Does West depot need replenishment today?

## What changed since the prior brief

Warehouse-connected records were corrected (schema revision 2). Provider timestamps on stock and reservations are unchanged; the authoritative payload bytes supersede the earlier read.

| Field | Prior brief (pre-correction) | Current connected read |
|--------|---------------------------|-------------------------|
| `depot://stock/west` — PART-19 available | 12 **case** | **6 case** |
| `depot://reservations/west` — reserved unit | Undefined in schema rev 2 | **4 each** (explicit unit) |
| Catalog `units_per_case` | **null** | **6** (current lot-specific catalog, rev 2) |
| Net individual units vs threshold 60 | Not computable → **hold** | **32** → **below 60** |
| Decision | Hold pending clarification | **Recommend replenishment** |

## Decision

**Recommend replenishment today** for PART-19 at West depot.

Policy compares **available minus reserved** in **individual units** to a threshold of **60**. With corrected sources, net available stock is **32 individual units**, which is strictly below 60.

This brief does not authorize placing orders; it records investigation only.

## Evidence summary

| Source | Class | Key facts (observed 2026-10-10 via workspace fetch unless noted) |
|--------|-------|---------------------------------------------------------------------|
| `depot://stock/west` | Record (inventory) | PART-19: **available 6**, unit **case**; schema revision 2; corrected bytes authoritative |
| `depot://reservations/west` | Record (operations) | PART-19: **reserved_quantity 4**, unit **each**; corrected field definition (schema revision 2) |
| `http://127.0.0.1:62116/catalog/part-19` | Record (catalog API) | **unit: each**; **units_per_case: 6**; schema revision 2 |
| `docs/policy.md` | Policy | Replenish when net individual units **&lt; 60**; at **60** hold steady; case conversion only with current lot-specific units per case; connected records supersede cached exports |
| `docs/cached.json` | **Superseded** export | Still marked superseded — **not used** |

### Threshold check (computable)

Required calculation:

`net_individual = (available in individual units) − (reserved in individual units)`

1. Convert on-hand cases using catalog **units_per_case: 6**: 6 cases × 6 = **36 individual** available.
2. Subtract reservations stated in **each**: 36 − 4 = **32 individual** net.
3. Compare to **60**: 32 &lt; 60 → **replenish** per policy.

Inventory counts in **case** and reservations in **each** is expected; conversion uses the catalog lot-specific pack size, not a guessed multiplier.

### Hypotheses considered

| Hypothesis | If true | What would refute it |
|------------|---------|----------------------|
| Corrected records → net below 60 → replenish | Supports ordering | Net ≥ 60 after re-read or broader stock query |
| Hold still required | Would block ordering | Missing unit or null `units_per_case` (not present on current read) |
| Cached export still reflects reality | Might suggest 60 net (72−12) | Policy and connected stock supersede cache; on-hand is **6 case**, not 72 each |

## Confidence

**High** that the policy-compliant call is replenishment given the corrected connected records.  
**Medium** on whether PART-19 is the only material SKU at West (query returned only this line).

## Unresolved questions

1. Are other SKUs at West depot material to replenishment that were not returned by the West stock query? (This brief only saw PART-19.)
2. If reservations release before receipt, could replenishment overshoot need? (Operational timing, not a policy block.)

## Strongest objection

A cautious planner may note unchanged provider timestamps and distrust “corrected bytes.” The inventory and operations records explicitly state corrected authoritative content; without a second surface contradicting them, policy requires using connected records over the superseded cache.

## Adversarial pass (self-review)

Challenged before acceptance: failure mode if **6 case** was mis-keyed would be wrong order size — mitigated by citing schema revision 2 text and catalog pack size together. Best alternative not chosen: **hold** until a human re-count; rejected because policy now has reservation unit and `units_per_case`. Load-bearing numbers (6, 4, 6, 32, 60) were read from connected fetches this session. Assumption inversion: if catalog pack size were wrong for the physical lot, net individual would be wrong — catalog is declared current lot-specific authority. Who bears cost: West operations if under-order after ignoring correction; planner if over-order without release timing. Hostile expert would ask for full-SKU stock list — carried as open control.

## Pre-mortem (if replenishment were ordered)

Most likely failure: order quantity sized in cases vs each without checking pack size, or ignoring reservations that consume four eaches while stock is case-counted.

## Evidence references

- Stock: `depot://stock/west`
- Reservations: `depot://reservations/west`
- Policy: `docs/policy.md`
- Catalog: `http://127.0.0.1:62116/catalog/part-19`
- Superseded cache: `docs/cached.json` (acknowledged superseded)
