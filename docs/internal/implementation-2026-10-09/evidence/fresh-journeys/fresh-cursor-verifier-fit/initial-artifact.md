# West depot replenishment — decision brief

**As of:** 2026-10-09 (local policy and connected records dated 2026-10-09T09:00:00Z where noted)  
**Question:** Does West depot need replenishment today?  
**Recommendation:** **Hold — do not recommend replenishment until unit conversion and reservation semantics are clarified.**

---

## Decision

Under [docs/policy.md](docs/policy.md), replenishment is recommended only when **available minus reserved** stock is **below 60 individual units** (`each`). At exactly 60, hold steady. Unknown case conversion or reservation units require a **hold pending clarification**.

Connected authoritative stock and reservations for West do not yield a defensible net position in `each`. A replenishment call today would rest on assumptions the policy explicitly forbids.

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
- **Available:** 12  
- **Unit:** **case** (not `each`)  
- **Schema revision:** 1  
- **Packaging catalog:** `http://127.0.0.1:57337/catalog/part-19`  
- **Reservations pointer:** `depot://reservations/west`  
- **Observed via workspace MCP:** 2026-10-09T22:15:46Z (complete coverage)

### Current reservations — `depot://reservations/west` (operations)

- **PART-19 `reserved_quantity`:** 4  
- **Unit:** **not stated** in schema revision 2 response; legacy field was `each`  
- **Explicit guidance in source:** do not assume the stock unit describes reservations; ask warehouse operations for field definition  
- **Observed via workspace MCP:** 2026-10-09T22:15:46Z (complete coverage)

### Packaging / conversion — packaging API

| Field | Value | Implication |
|-------|--------|-------------|
| `units_per_case` | **null** | Cannot convert 12 cases to `each` per policy |
| `unit` | `each` | Describes catalog row, not stock on hand |
| `authority` | current lot-specific catalog | Points to `depot://supplier/lot-k` in references |

**Fetch:** `http://127.0.0.1:57337/catalog/part-19` (200, schema revision 1)

### Superseded cache (not used)

[docs/cached.json](docs/cached.json) shows PART-19 with 72 available, 12 reserved, unit `each`, status **superseded cached export**. Policy requires connected records over this file; it is listed here only to show why a stale snapshot must not drive today’s call.

### Blocked follow-up source

- **`depot://supplier/lot-k`:** permission denied for this session principal. Content cannot be inferred; likely needed for lot-specific units-per-case called out by the catalog reference.

---

## Why net position is unknown

Net for policy comparison must be:

```text
(available in each) − (reserved in each)
```

Today we have:

1. **Available** in **cases** (12), with **no** valid `units_per_case` on the current catalog row.  
2. **Reserved** quantity **4** with **no** authoritative unit on the operations record.

Any numeric comparison to the 60 `each` threshold would require guessing case pack size and/or reservation unit, which violates policy.

### Illustrative bounds (not for action)

If reservations were `each` and case pack were *n* units per case, net would be `12n − 4`:

| Units per case (*n*) | Net (`each`) | Policy signal (if reservations = `each`) |
|----------------------|--------------|---------------------------------------------|
| 5 | 56 | Below 60 → would recommend replenish |
| 6 | 68 | Above 60 → would hold |
| 7 | 80 | Above 60 → would hold |

These rows are **sensitivity only**; they are **not** evidence because *n* and reservation units are unsettled.

---

## Unresolved questions

1. **What is the current lot-specific `units_per_case` for PART-19 at West?** (Catalog returns `null`; supplier lot record `depot://supplier/lot-k` was not readable here.)  
2. **What unit does `reserved_quantity` use for PART-19 in the schema revision 2 operations feed?** (Source directs clarification to warehouse operations.)  
3. **Who can grant read access to `depot://supplier/lot-k` (or provide equivalent lot metadata) so case stock can be converted under policy?**  
4. **After units are known, should AUX-22 reservations (mentioned as unrelated `each` SKU on the West reservations record) affect this PART-19 decision?** (Not part of PART-19 row; confirm scope with operations if cross-SKU rules exist.)

---

## Suggested next steps (information only — no orders authorized)

1. Obtain **units per case** for the active PART-19 lot and **reservation unit** for the quantity of 4 from warehouse operations (or authorized supplier/lot source).  
2. Recompute **12 × units_per_case − reserved_in_each** and apply the 60 `each` rule.  
3. Retain **docs/cached.json** as historical only; refresh decision from `depot://stock/west` and `depot://reservations/west`.

---

## Source log

| URI / artifact | Role | Freshness |
|----------------|------|-----------|
| `depot://stock/west` | Authoritative availability | 2026-10-09T09:00:00Z record; MCP read 2026-10-09 |
| `depot://reservations/west` | Authoritative reservations | Same |
| `http://127.0.0.1:57337/catalog/part-19` | Packaging conversion | `observedAt` 2026-10-09T09:00:00Z |
| [docs/policy.md](docs/policy.md) | Decision rules | Local |
| [docs/cached.json](docs/cached.json) | Superseded | Do not use for decision |
