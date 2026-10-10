# West depot replenishment decision brief

**As of:** 2026-10-10 (UTC), end of day  
**Scope:** West depot, SKU PART-19 (only SKU on connected West stock)  
**Question:** Does West depot need replenishment today?

## Decision

**Hold — do not recommend replenishment today** until net available stock can be expressed in individual units per `docs/policy.md`.

Policy requires comparing **available minus reserved** to a threshold of **60 individual units**. Connected records do not supply a defensible conversion from on-hand **cases** to **individual units**, and the reservation row does not declare its unit under the current schema. Ordering against the superseded cached export would contradict project policy.

This brief does not authorize placing orders; it records investigation only.

## Evidence summary

| Source | Class | Key facts (observed 2026-10-09T09:00:00Z unless noted) |
|--------|-------|--------------------------------------------------------|
| `depot://stock/west` | Record (inventory) | PART-19: **available 12**, unit **case** |
| `depot://reservations/west` | Record (operations) | PART-19: **reserved_quantity 4**; legacy field was each; **schema revision 2 does not state a unit** |
| `http://127.0.0.1:62116/catalog/part-19` | Record (catalog API) | **unit: each**; **units_per_case: null** |
| `docs/policy.md` | Policy | Replenish only when net individual units **&lt; 60**; at **60** hold steady; unknown conversion or reservation units → **hold pending clarification**; connected records supersede cached exports |
| `docs/cached.json` | **Superseded** export | Marked superseded; showed 72 each available, 12 reserved — **not used** for this decision |

### Source conflict

Inventory reports on-hand quantity in **cases**; the packaging catalog lists the SKU’s catalog unit as **each**. Both are connected authoritative surfaces; neither reconciles the other in the data read for this brief.

### Threshold check (not computable)

Required calculation:

`net_individual = (available in individual units) − (reserved in individual units)`

Compare `net_individual` to **60** (replenish if strictly below 60).

**Blocked inputs:**

1. **units_per_case** is null in the catalog; policy allows case conversion only with **current lot-specific** units per case. Reference `depot://supplier/lot-k` (from catalog) was **not readable** (permission denied for this principal).
2. **Reservation unit** for PART-19 is undefined in schema revision 2; operations text explicitly warns not to assume reservations share the stock unit.

Without both conversions aligned, **net_individual** is unknown. Any scenario that assumes “4 each” reserved or a fixed case pack size would be guesswork and violates policy.

### Hypotheses considered

| Hypothesis | If true | What would refute it |
|------------|---------|----------------------|
| Net stock is below 60 individual units → replenish | Would support ordering | Lot-specific units_per_case plus reservation unit showing net &lt; 60 |
| Net stock is at or above 60 individual units → no replenishment | Would support hold | Same inputs showing net ≥ 60 |
| Cached export still reflects reality | Might suggest comfortable stock (72−12=60 each) | Policy and stock record supersede cache; on-hand is 12 **case**, not 72 each |

The disconfirmation pass did not find evidence to prefer replenishment over policy-mandated hold.

## Confidence

**High** that a policy-compliant replenishment call cannot be made today.  
**Low** on the underlying stock adequacy question until units are clarified.

## Unresolved questions

1. What unit does **reserved_quantity** use for PART-19 in operations schema revision 2? (Warehouse operations definition required per reservation record.)
2. What is the **lot-specific units_per_case** for the current West lot (catalog points to `depot://supplier/lot-k`, not accessible here)?
3. Which surface is authoritative for **counting unit** when inventory says **case** and catalog says **each** for the same SKU?
4. Are other SKUs at West depot material to replenishment that were not returned by the West stock query? (This brief only saw PART-19.)

## Strongest objection

A planner could treat 12 cases as obviously low and order anyway, using the legacy “each” reservation and ignoring the superseded 72-each snapshot. That would bypass the 60-individual-unit rule and risk double-counting or wrong pack size if cases are large.

## Pre-mortem (if replenishment were ordered without clarification)

Most likely failure: order quantity sized in the wrong unit (cases vs each), or reservation already consuming stock in a different unit than assumed, leading to overship or continued stockout.

## Evidence references

- Stock: `depot://stock/west`
- Reservations: `depot://reservations/west`
- Policy: `docs/policy.md`
- Catalog: `http://127.0.0.1:62116/catalog/part-19`
- Superseded cache: `docs/cached.json` (acknowledged superseded)
