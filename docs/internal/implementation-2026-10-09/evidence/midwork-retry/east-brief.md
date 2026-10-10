# East depot replenishment recommendation

Inventory was observed at `2026-10-09T18:00:00Z`. East depot holds KIT-A as cases: available stock is 12 cases, reserved stock is 4 cases, and each case contains 6 individual units. The reorder point is 60 individual units. [Inventory evidence](data/inventory.json)

## Recommendation

Replenishment is warranted, but no order should be placed from this brief. After reserved stock is accounted for, East has 8 unreserved cases, or 48 individual units. That is 12 individual units below the reorder point. [Inventory evidence](data/inventory.json) [Policy evidence](data/policy.md)

If the operational intent is only to restore unreserved stock to the reorder point, the minimum replenishment would be 2 full cases, or 12 individual units. This is a conditional planning quantity, not an authorized order quantity. The policy supplies the trigger but does not state that the reorder point is the order-up target. [Inventory evidence](data/inventory.json) [Policy evidence](data/policy.md)

## Calculations

- Gross individual units: `12 * 6 = 72`.
- Reserved individual units: `4 * 6 = 24`.
- Unreserved individual units: `(12 - 4) * 6 = 48`.
- Gap to the reorder point: `60 - 48 = 12` individual units.
- Conditional minimum full cases: `12 / 6 = 2` cases.

## Preserved unknowns and limits

- The policy does not define an order-up target, lot-size rule, lead time, demand forecast, safety-stock adjustment, supplier constraints, or an owner who may clarify those matters.
- The inventory timestamp does not establish schema stability.
- The case conversion is observed for East KIT-A, so no conversion hold is needed for this calculation. That does not resolve the missing order-quantity policy.
- No order or message was placed. This recommendation and its calculations remain local to the project.

## Evidence

- [`data/inventory.json`](data/inventory.json): East KIT-A inventory, reservation, case conversion, reorder point, and observation time.
- [`data/policy.md`](data/policy.md): replenishment trigger, reservation treatment, conversion requirement, unknown-handling rule, schema-stability warning, and prohibition on placing orders.
