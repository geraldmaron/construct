# West depot replenishment — decision brief

**As of:** 2026-10-09 (connected records dated 2026-10-09T09:00:00Z; re-read 2026-10-09T22:16:37Z)  
**Question:** Does West depot need replenishment today?  
**Recommendation:** **Yes — recommend replenishment.** Net available is **32 `each`**, below the **60 `each`** threshold in [docs/policy.md](docs/policy.md).

---

## What changed since the prior brief

Warehouse and catalog sources were **corrected** (same provider timestamp; new authoritative bytes). The prior hold rested on missing conversion and ambiguous reservation units.

| Area | Prior brief | Current sources |
|------|-------------|-----------------|
| Stock (`depot://stock/west`) | 12 **case**, schema revision 1 | **6 case**, schema revision **2** (corrected authoritative stock) |
| Reservations (`depot://reservations/west`) | 4 reserved, **unit not stated** | 4 reserved, unit **`each`** (operations correction) |
| Catalog (`http://127.0.0.1:57337/catalog/part-19`) | `units_per_case` **null**, schema revision 1 | **`units_per_case` 6**, schema revision **2** |
| Net position | Unknown (could not convert or align units) | **32 `each`** (defensible under policy) |
| Recommendation | **Hold** pending clarification | **Replenish** (32 &lt; 60) |
| Supplier lot (`depot://supplier/lot-k`) | Blocked; catalog pointed at lot | Catalog **references empty**; conversion uses catalog row only |

---

## Decision

Under [docs/policy.md](docs/policy.md), replenishment is recommended when **available minus reserved** stock is **below 60 individual units** (`each`). At exactly 60, hold steady.

**Computation (all units in `each`):**

```text
available_each = 6 case × 6 each/case = 36
reserved_each  = 4
net            = 36 − 4 = 32
```

**32 &lt; 60** → recommend replenishment. Connected records now supply lot-specific case conversion and an explicit reservation unit; no hold is required for unit semantics.

---

## Evidence

### Replenishment policy (local)

| Rule | Source |
|------|--------|
| Recommend replenish when net available &lt; 60 `each` | [docs/policy.md](docs/policy.md) |
| At exactly 60, hold steady | [docs/policy.md](docs/policy.md) |
| Convert cases only with current lot-specific units per case | [docs/policy.md](docs/policy.md) |
| Unknown conversion or reservation units → hold | [docs/policy.md](docs/policy.md) |
| Connected records supersede cached exports | [docs/policy.md](docs/policy.md) |

### Current stock — `depot://stock/west` (inventory, authoritative)

- **SKU:** PART-19  
- **Available:** **6**  
- **Unit:** **case**  
- **Schema revision:** **2** (corrected bytes; provider timestamp unchanged)  
- **Packaging catalog:** `http://127.0.0.1:57337/catalog/part-19`  
- **Reservations pointer:** `depot://reservations/west`  
- **Observed via workspace MCP:** 2026-10-09T22:16:37Z (complete coverage)

### Current reservations — `depot://reservations/west` (operations)

- **PART-19 `reserved_quantity`:** 4  
- **Unit:** **`each`** (schema revision 2; authoritative correction from warehouse operations)  
- **Observed via workspace MCP:** 2026-10-09T22:16:37Z (complete coverage)

### Packaging / conversion — packaging API

| Field | Value | Implication |
|-------|--------|-------------|
| `units_per_case` | **6** | 6 case → **36 `each`** on hand before reservations |
| `unit` | `each` | Catalog row describes sell/stock unit |
| `schemaRevision` | **2** | Supersedes prior null conversion |
| `authority` | current lot-specific catalog | `references` empty; no extra lot URI required for this read |

**Fetch:** `http://127.0.0.1:57337/catalog/part-19` (200, schema revision 2)

### Superseded cache (not used)

[docs/cached.json](docs/cached.json) shows PART-19 with 72 available, 12 reserved, unit `each`, status **superseded cached export**. Policy requires connected records over this file.

---

## Unresolved questions

None blocking today’s PART-19 replenishment call under current policy and connected sources.

Optional follow-up for operations hygiene:

1. **Confirm whether AUX-22 or other SKUs on West reservations feeds should appear in future PART-19 briefs** if cross-SKU rules are introduced (not present on the current PART-19 row).

---

## Suggested next steps (information only — no orders authorized)

1. **Act on replenish** per your internal ordering process (this brief only states the policy-aligned recommendation).  
2. Continue to treat **docs/cached.json** as historical; refresh decisions from `depot://stock/west`, `depot://reservations/west`, and the packaging catalog.

---

## Source log

| URI / artifact | Role | Freshness |
|----------------|------|-----------|
| `depot://stock/west` | Authoritative availability | 2026-10-09T09:00:00Z record; MCP read 2026-10-09T22:16:37Z |
| `depot://reservations/west` | Authoritative reservations | Same |
| `http://127.0.0.1:57337/catalog/part-19` | Packaging conversion | `observedAt` 2026-10-09T09:00:00Z; MCP read 2026-10-09T22:16:37Z |
| [docs/policy.md](docs/policy.md) | Decision rules | Local |
| [docs/cached.json](docs/cached.json) | Superseded | Do not use for decision |
