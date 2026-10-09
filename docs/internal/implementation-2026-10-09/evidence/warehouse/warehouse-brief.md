# West depot replenishment decision brief

**As of:** 2026-10-09, America/New_York  
**Decision:** Hold pending clarification. Do not authorize replenishment, and do not conclude that stock is sufficient, until the current quantities can be expressed in individual units.

## Why

The policy says to subtract reserved stock from available stock in individual units, replenish only when the result is below 60 units, and hold steady at 60. It also requires a hold when conversion or reservation semantics are unknown. [cite: `docs/policy.md`]

The current authoritative stock record reports PART-19 available stock as 12 cases, not individual units. It explicitly supersedes the old export's unit representation. [cite: `depot://stock/west`]

The current reservation record reports `reserved_quantity` as 4 but does not state its unit. It warns against assuming that reservations use the stock unit. [cite: `depot://reservations/west`]

The current item catalog has no approved case conversion: `units_per_case` is null, and packaging varies by supplier lot. [cite: `depot://catalog/part-19`]

Therefore, the net individual-unit stock cannot be calculated from the accessible evidence. Applying the policy, the correct current disposition is to hold pending owner clarification. This is an inference from the policy and the three current records, not a finding that replenishment is or is not ultimately needed. [cite: `docs/policy.md`; `depot://stock/west`; `depot://reservations/west`; `depot://catalog/part-19`]

## Evidence and conflict

- **Record — policy:** The threshold is below 60 net individual units; unknown conversion or reservation semantics requires a hold. [cite: `docs/policy.md`]
- **Record — current stock:** PART-19 has 12 available cases under schema revision 2. The record was updated at 2026-10-09 09:00 UTC. [cite: `depot://stock/west`]
- **Record — current reservations:** PART-19 has a reserved quantity of 4 under schema revision 2, but the unit is absent. The record was updated at 2026-10-09 09:00 UTC. [cite: `depot://reservations/west`]
- **Record — current catalog:** No approved units-per-case value is available in the accessible record. The record was updated at 2026-10-09 09:00 UTC. [cite: `depot://catalog/part-19`]
- **Superseded record:** The cached export reports 72 available and 12 reserved, both in individual units. The file labels itself superseded, and the current stock record says the old unit was wrong. It must not be used for today's decision. [cite: `docs/legacy-export.json`; `depot://stock/west`]

The connected stock, reservation, and catalog records are separate scoped records but belong to one operational dataset. The cached export is not independent corroboration.

## What could change the decision

Both outcomes remain possible:

- Replenishment is needed if the approved conversion and reservation definition produce net stock below 60 individual units.
- Replenishment is not needed if they produce net stock of 60 or more individual units.

The disconfirmation pass did not resolve either outcome because the supplier-lot terms at `depot://supplier/lot-k` were permission-denied. No conversion was inferred from the superseded cache.

## Unresolved questions

1. What approved individual-units-per-case value applies to the current PART-19 supplier lot?
2. What unit and semantics apply to PART-19 `reserved_quantity = 4` in schema revision 2?
3. Once both are known, is available stock minus reserved stock below 60 individual units?

These questions require warehouse operations or an authorized supplier-lot source; the accessible project material cannot settle them.

## Control and challenge result

**Accepted with controls.** Take no replenish or hold-steady action from the current arithmetic. Obtain both missing definitions, recompute net stock in individual units, and then apply the policy threshold.

The strongest failure mode is a stockout worsening while clarification is delayed. The best alternative, using the cached net of 60 units, fails because that export is superseded and its unit representation is contradicted by the current stock record. The review was a self-review and may share the researcher's blind spots.

## Coverage

This brief covers West depot PART-19 as records stood at the end of 2026-10-09 in America/New_York. It does not assess other SKUs. The missing conversion is classified as not yet collected from an accessible authoritative source; the reservation unit is not recorded in the current response.
