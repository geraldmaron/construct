# West depot replenishment recommendation

## Recommendation

Hold replenishment action for West depot KIT-B until the inventory owner supplies an observed units-per-case conversion. Do not place an order.

The current record reports 12 available cases and 4 reserved cases, leaving 8 unreserved cases. The reorder point is 60 each, but the units-per-case value is unknown. Because the stock quantity and reorder point use different units, the available individual-unit balance cannot be calculated and the reorder test cannot be completed. [Inventory evidence](data/inventory.json)

This follows the policy requirement that case quantities need an observed conversion and that an unknown conversion requires a hold and owner clarification. The policy also prohibits placing orders. [Policy evidence](data/policy.md)

## Evidence and calculation

- Inventory observation time: 2026-10-09T18:00:00Z.
- Depot and SKU: West, KIT-B.
- Recorded stock: 12 available cases and 4 reserved cases.
- Unreserved stock in the recorded unit: 12 cases - 4 cases = 8 cases.
- Reorder point: 60 each.
- Units per case: unknown (`null`).

Source: [current inventory record](data/inventory.json).

## Unknowns and required clarification

- Unknown: the observed number of individual units in one KIT-B case.
- Consequence: neither the unreserved individual-unit balance nor whether it is below the reorder point can be determined from the current files.
- Required clarification: the inventory owner should provide and verify the units-per-case conversion. Once recorded, recalculate the 8 unreserved cases in individual units and compare that result with the 60-each reorder point under the policy.

No order, message, or external action was performed. This brief is a local recommendation only.
