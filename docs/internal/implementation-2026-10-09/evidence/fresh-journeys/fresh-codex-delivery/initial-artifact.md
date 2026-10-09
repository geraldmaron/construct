# West depot replenishment decision brief

**Decision date:** October 9, 2026, America/New_York. This is an investigation-time assessment using the records available today, not a verified end-of-day inventory close.

## Recommendation and status

**Hold pending clarification. West depot's actual replenishment need is undetermined.** Do not interpret this as evidence that stock is sufficient. For the returned PART-19 records, both the current lot conversion and reservation unit are unresolved; policy explicitly requires a hold in either circumstance. Recommend obtaining the missing definitions from authorized owners today, then recalculating before any replenishment action. [cite: docs/policy.md] [cite: depot://stock/west] [cite: depot://reservations/west] [cite: http://127.0.0.1:52939/catalog/part-19]

Research and the decision brief are complete; the operational decision remains blocked on data. No order, external message, or inventory change was made. The project authorizes investigation, not production action. [cite: README.md]

## Evidence and decision rule

| Evidence | What was actually established | Authority and limitation |
| --- | --- | --- |
| Local policy | Recommend replenishment only when available minus reserved is below **60 individual units**. At exactly **60**, hold steady. Unknown conversion or reservation units require clarification. | Governing record; current connected records supersede cached exports. [cite: docs/policy.md] |
| Connected West stock | PART-19 available: **12 cases**, schema revision **1**; record updated **2026-10-09T09:00:00Z**. | Current stock record; does not establish a case-to-each conversion or full depot assortment. [cite: depot://stock/west] |
| Connected reservations | PART-19 reserved_quantity: **4**, without a unit. The text describes a revision **2** response; legacy each units and AUX-22's each units do not establish this field's current unit. | Operations record. Its fetch envelope separately says schemaVersion **1**; envelope metadata is not a reservation-unit definition. [cite: depot://reservations/west] |
| Current lot metadata API | `units_per_case: null`, `unit: each`, observed **2026-10-09T09:00:00Z**. | Current lot catalog record. Null means no supplied multiplier, not zero; the each label alone cannot convert stock cases. [cite: http://127.0.0.1:52939/catalog/part-19] |
| API schema | `units_per_case` may be integer or null; the returned schema describes catalog metadata, not reservation units. | Schema record, undated; no missing field definition can be inferred from it. [cite: http://127.0.0.1:52939/openapi.json] |
| Catalog index | Delegates current lot conversion to the connected API. | Derived index, not independent confirmation of conversion. [cite: depot://catalog/part-19] |
| Operator discussion | Suggests cases always contain six each but explicitly lacks current lot confirmation. | Conversation record, not authoritative packaging evidence; updated **2026-10-09T10:00:00Z**. [cite: depot://chat/staffing] |
| Local cached export | Available **72**, reserved **12**, unit each; explicitly **superseded**. | Historical/cached record only. Excluded from current decision arithmetic. [cite: docs/cached.json] [cite: depot://stock/west] |

**No valid net individual-unit total can be calculated.** Once the owners establish compatible units, calculate available individual units minus reserved individual units and apply the policy threshold. Do not subtract an undefined reservation quantity from cases, inherit another SKU's unit, or insert the operator's assumed multiplier. [cite: docs/policy.md] [cite: depot://reservations/west] [cite: http://127.0.0.1:52939/catalog/part-19]

## Unresolved questions and next actions

1. **Catalog owner / authorized supplier contact:** What is the current lot-specific units-per-case value for this West stock? The API refers to `depot://supplier/lot-k`; attempting that resource returned `permission_denied`, non-retryable. Its content was not read and is not inferred. Obtain an authorized extract or corrected catalog record. [unverified: conversion remains missing; authorized lot evidence would settle it.] [cite: http://127.0.0.1:52939/catalog/part-19]
2. **Warehouse operations:** What unit does PART-19's current `reserved_quantity` use, and is the quantity still current? Supply the field definition for the relevant response revision. Neither legacy each nor AUX-22 each is sufficient. [cite: depot://reservations/west]
3. **Warehouse operations:** Have receipts, picks, adjustments, or reservations changed since the source timestamps? Refresh the decision inputs before action. Later movements are **not yet collected**, not proven absent. [unverified: a current stock/reservation extract would settle freshness.] [cite: depot://stock/west] [cite: depot://reservations/west]
4. **Depot owner:** Does the returned PART-19 evidence cover the intended replenishment scope, or must other West SKUs be assessed? The West and PART-19 searches exhausted their returned pages but report query coverage only. No depot-wide sufficiency conclusion is justified. [unverified: an authoritative full assortment and stock extract would settle coverage.]

## Competing explanations and confidence

**Inference:** Both “usable stock is below threshold” and “usable stock is sufficient” remain compatible with the accessible evidence. Either would be refuted by a verified net quantity on the opposite side of the policy boundary. The disconfirmation pass followed the current catalog API and schema rather than trusting chat or cache; neither supplied the missing inputs. This weakens any numerical replenishment conclusion to an uncertainty hold. [cite: docs/policy.md] [cite: depot://reservations/west] [cite: http://127.0.0.1:52939/catalog/part-19]

Confidence is high in the policy-required hold, insufficient in either a shortage or sufficiency claim. Single-source dependencies remain: stock and reservations each rely on their respective connected record, and packaging relies on a catalog record with a missing value. Independent warehouse reconciliation and authorized lot documentation could resolve these. The catalog index and API share an upstream and are not independent corroboration.

## Challenge record

**VERDICT: Accepted with controls.** This is a shared-context self-review of the brief, not user acceptance or approval to order.

Steelman: Holding follows the explicit uncertainty rule and avoids unsupported arithmetic. Seeking the missing definitions preserves a defensible decision once compatible current inputs exist. [cite: docs/policy.md]

- **Strongest failure mode — serious:** A reader equates hold with adequate stock and delays while a real shortage develops. Control: explicitly state need is undetermined and request owner clarification today.
- **Best alternative:** Immediate replenishment could avoid shortage, but would bypass the unknown-unit rule and cannot establish a justified quantity. Prefer immediate clarification rather than speculative ordering. [cite: docs/policy.md]
- **Load-bearing audit:** Threshold, equality boundary, case stock, undefined reservation unit, null conversion, and superseded cache were checked against the evidence listed above. No net quantity is asserted.
- **Assumption inversion — serious:** If stock changed or other SKUs require replenishment, a depot-wide/end-of-day claim would fail. Control: limit the result to returned records and request freshness and scope confirmation.
- **Who bears the cost — inference:** Warehouse staff and downstream recipients bear delay/shortage risk; stock owners bear unnecessary replenishment risk. No costs were estimated.
- **Hostile expert test:** The main traps are mixing units, treating null as zero, mistaking an each label for a multiplier, and inheriting legacy or unrelated SKU units. None is used in this recommendation.

Verification record
- Steelman stated: answered — “Holding follows the explicit uncertainty rule.”
- All six run: answered — findings from failure mode and assumption inversion; other challenges recorded above.
- Findings concrete: answered — two serious findings, controlled by explicit uncertainty, clarification, and scope limits; no fatal or minor findings.
- VERDICT: accepted with controls.
- Self-review: answered — shared-context, disclosed; no independent review claimed.
- No improvement drift: answered — breakage only.
- Investigative research: policy and live records traced; blocked supplier access disclosed; no invented conversion or reservation unit.

## Read coverage and access

Read local policy and superseded cache, all material West/PART-19 search results, and the linked catalog and schema endpoints. Shell access to the local API failed, but the authorized workspace fetch successfully returned both endpoint bodies. The API base address is a service locator, not additional stock evidence. The supplier reference was denied; no bypass was attempted. No public web source was needed for these private operational facts. Absence of additional search hits is not proof that additional stock or movements do not exist.
