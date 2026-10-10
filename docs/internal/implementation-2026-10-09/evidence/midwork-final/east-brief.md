# East depot replenishment recommendation

## Recommendation

Replenish `KIT-A`, but do not place an order from this brief. East has 12 cases available and 4 cases reserved, leaving 8 unreserved cases. At 6 units per case, that is 48 available individual units after reservations, below the reorder point of 60 each. The replenishment quantity is unknown because the current policy gives no target stock level or order-up-to rule.

## Evidence and calculation

- The inventory snapshot was observed at `2026-10-09T18:00:00Z`. The East record identifies `KIT-A`, 12 available cases, 4 reserved cases, 6 units per case, and a reorder point of 60 each. [Inventory evidence](data/inventory.json#L2-L14)
- Net cases: `12 - 4 = 8`.
- Net individual units: `8 × 6 = 48`.
- Threshold comparison: `48 < 60`, so East is below its reorder point.
- The policy says to order only when available individual units are below the depot reorder point after reserved stock is accounted for, requires an observed units-per-case conversion for case quantities, and says not to place orders. [Policy evidence](data/policy.md#L1-L2)

## Unknowns and limits

- Replenishment quantity: **unknown**. Neither cited source defines a target stock level, order-up-to quantity, minimum order, case-pack ordering constraint, lead time, or demand forecast.
- Schema stability: **unknown**. The policy states that inventory timestamps do not establish schema stability.
- This is a local recommendation only. No order was placed and no message was sent.
