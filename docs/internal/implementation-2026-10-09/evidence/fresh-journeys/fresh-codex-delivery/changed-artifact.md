# West depot replenishment decision brief

**Rechecked:** October 9, 2026, America/New_York. Confidential operational evidence; local recommendation only. This assessment uses the corrected records returned during this investigation, not a verified end-of-day inventory close.

## Recommendation and status

**Recommend replenishment for West depot PART-19.** Corrected stock is **6 cases**, current lot packaging is **6 individual units per case**, and reservations are explicitly **4 individual units**. Net stock is therefore **32 individual units**, below the policy threshold of **60**. The previous “hold pending clarification” recommendation is superseded: both missing unit definitions are now resolved. Sources: `docs/policy.md`, `depot://stock/west`, `depot://reservations/west`, `http://127.0.0.1:52939/catalog/part-19`.

This establishes a replenishment need for the returned SKU, not an order quantity or a depot-wide assessment. No order, external message, or inventory change was made. Production action is not authorized by this project. Source: `README.md`.

## What changed

The “previous brief” column preserves the observations in the prior version of this document; those observations are historical, not current inputs. Revision links to the prior recorded brief, `deliverable-d3a6ee1e`.

| Decision input | Previous brief | Corrected current source | Effect |
| --- | --- | --- | --- |
| Available stock | 12 cases; schema revision 1 | 6 cases; schema revision 2 | Replace the old stock quantity. Source: `depot://stock/west`. |
| Reservations | Quantity 4; unit unresolved; response/envelope revision mismatch | Quantity 4, explicitly each; schema revision 2 | Reservation quantity is now dimensionally usable. Source: `depot://reservations/west`. |
| Current lot conversion | `units_per_case: null`; each label insufficient | `units_per_case: 6`, unit each; schema revision 2 | Convert current cases using the authoritative lot record. Source: `http://127.0.0.1:52939/catalog/part-19`. |
| Net individual units | Undetermined | 32 | A numerical comparison is now justified. |
| Recommendation | Hold pending clarification; need undetermined | Recommend replenishment for PART-19 | Net stock is below the policy threshold. Source: `docs/policy.md`. |

**Unchanged timestamps do not mean unchanged evidence.** Stock and reservations still carry `2026-10-09T09:00:00Z`; the catalog payload retains that observation timestamp. The stock record explicitly says its corrected bytes are authoritative despite the unchanged provider timestamp. This recheck used the returned content and revision, not timestamp advancement, to identify the correction. The source refresh detected changed stock, reservation and catalog records. These timestamps still do not prove that later warehouse movements are absent.

## Evidence and decision rule

The policy recommends replenishment only when available minus reserved stock is **below 60 individual units**; at exactly **60**, hold steady. Unknown conversion or reservation units still require a clarification hold, but neither is unknown in the corrected records. Current connected records supersede cached exports. Source: `docs/policy.md`.

1. Available individual units: **6 cases × 6 each/case = 36 each**.
2. Reserved individual units: **4 each**; do not multiply this quantity by the case conversion.
3. Net individual units: **36 − 4 = 32 each**.
4. Comparison: **32 < 60**, so recommend replenishment.
5. Gap to the policy boundary: **60 − 32 = 28 each**. This is a threshold gap, **not a prescribed purchase quantity**; the policy supplies no order-sizing rule.

Arithmetic is derived from the current stock, reservations and lot API, with the threshold from policy. Sources: `depot://stock/west`, `depot://reservations/west`, `http://127.0.0.1:52939/catalog/part-19`, `docs/policy.md`.

The catalog index delegates conversion to the API and is not independent corroboration. The API schema permits an integer or null conversion; the actual corrected response supplies the integer. Operator discussion claiming that all cases always contain six each remains non-authoritative; the matching value here is justified only for the current item and lot. Sources: `depot://catalog/part-19`, `http://127.0.0.1:52939/openapi.json`, `depot://chat/staffing`.

`docs/cached.json` remains explicitly **superseded**. Its 72 available and 12 reserved each are historical and excluded from the current calculation. The prior brief's unresolved-unit hold was justified by its then-observed inputs; it is not carried forward after correction.

## Unresolved questions and next actions

1. **Warehouse operations:** Confirm receipts, picks, adjustments and reservation changes since the provider timestamps before acting. Subsequent movements are **not yet collected**, not proven absent.
2. **Depot owner:** Confirm whether other West SKUs must be assessed. West and PART-19 searches exhausted their returned results, but coverage is query-only, not an authoritative full assortment.
3. **Authorized replenishment owner:** Determine order quantity and timing using approved target stock, inbound supply, lead times and ordering constraints. These are **not established by the inspected sources**; the threshold gap alone does not settle them.

The old questions about lot conversion and reservation units are resolved by corrected authoritative records. The previous investigation recorded denied supplier access; supplier content remains unread and no access workaround was attempted. The corrected catalog has no supplier reference and supplies the conversion directly, so that historical denial no longer blocks this calculation. It does not establish supplier terms or ordering constraints.

## Challenge record

**VERDICT: Accepted with controls for recommendation only.** Shared-context self-review, not independent review, user acceptance or approval to order.

- **Steelman:** The corrected item-specific inputs now support compatible-unit arithmetic and the policy's below-threshold rule.
- **Strongest failure mode:** Someone treats the threshold gap as an approved order, or treats a single-SKU snapshot as a complete depot assessment. Controls: separate need from sizing, retain scope limits and refresh before action.
- **Best alternative:** Continue the clarification hold until independent physical reconciliation. That may be appropriate if operations identifies a new discrepancy, but the inspected corrected sources no longer justify a hold for missing units. Accept the replenishment recommendation with freshness and authorization controls.
- **Load-bearing audit:** Use corrected case stock, current lot multiplier and explicit each reservations; exclude the superseded cache and operator generalization. Retain the strict inequality and equality boundary.
- **Assumption inversion:** If later movements changed stock or reservations, recalculate; if other SKUs are in scope, investigate them separately. Neither possibility invalidates the arithmetic on the returned records.
- **Cost bearer, inferred:** Warehouse staff and downstream recipients bear shortage risk; inventory owners bear excess-stock risk. No costs were estimated.
- **Hostile expert test:** Unchanged timestamps cannot conceal content corrections; reservation each must not be treated as cases; a conversion for this lot is not universal packaging evidence.

## Read coverage and verification

Read the previous brief, local policy, superseded cache and project action boundary; fetched current stock, reservations, catalog index, operator discussion, lot API and API schema through the authorized workspace connector. West and PART-19 searches returned no continuation. Record-level completeness does not establish depot-wide completeness. No public-web research was needed for private operational facts.

The live lot response supplies the conversion directly. Calculation and policy boundary were checked against the returned inputs; the challenge retains freshness, coverage and order-sizing limitations. No independent physical inventory reconciliation or production action was performed.
