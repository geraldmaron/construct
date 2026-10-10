# West depot replenishment recommendation

Inventory was observed at `2026-10-09T18:00:00Z`. West depot holds KIT-B as cases: available stock is 12 cases, reserved stock is 4 cases, and the units-per-case conversion is unknown. The reorder point is 60 individual units. [Inventory evidence](data/inventory.json)

## Recommendation

Hold the replenishment decision pending an observed units-per-case conversion for West KIT-B. Do not place an order from this brief. The policy requires the reorder test in available individual units after reserved stock is accounted for, and it requires an observed conversion for case quantities. Without West's conversion, the unreserved case balance cannot be converted to individual units and compared reliably with the reorder point. [Inventory evidence](data/inventory.json) [Policy evidence](data/policy.md)

Once an owner supplies and records the West KIT-B conversion in the current inventory source, recalculate unreserved individual units from the observed case balances and compare that result with the reorder point. The current evidence does not support either a replenishment trigger or an order quantity. [Inventory evidence](data/inventory.json) [Policy evidence](data/policy.md)

## What can be established

- Unreserved stock is 8 cases: `12 - 4 = 8`.
- The conversion from those cases to individual units is unknown.
- Whether unreserved individual units are below the 60-unit reorder point is therefore unknown.

## Preserved unknowns and limits

- West KIT-B units per case is not recorded.
- The policy does not identify the owner who can clarify the conversion.
- The policy does not define an order-up target, lot-size rule, lead time, demand forecast, safety-stock adjustment, or supplier constraints.
- The inventory timestamp does not establish schema stability.
- No order or message was placed. This recommendation remains local to the project.

## Evidence

- [`data/inventory.json`](data/inventory.json): West KIT-B inventory, reservation, missing case conversion, reorder point, and observation time.
- [`data/policy.md`](data/policy.md): replenishment trigger, reservation treatment, conversion requirement, unknown-handling rule, schema-stability warning, and prohibition on placing orders.
