# West depot replenishment decision brief

**As of:** 2026-10-09 (local planning day)  
**Depot:** West  
**SKU in scope:** PART-19  
**Prepared for:** Same-day replenishment go / no-go  
**Rechecked:** 2026-10-09 after warehouse record corrections (connected sources refreshed)

## Decision

**Recommend replenishment today.**

Net individual-unit position is **32** (36 available minus 4 reserved), which is **below** the policy threshold of 60. Replenishment should be initiated per local policy.

## What changed since the prior brief

| Area | Prior (pre-correction) | Current (authoritative) | Effect on decision |
| --- | --- | --- | --- |
| Stock (`depot://stock/west`) | 12 **case**, schema revision 1 | **6 case**, schema revision 2 | On-hand halved; corrected bytes marked authoritative despite unchanged provider timestamp |
| Reservations (`depot://reservations/west`) | Reserved 4, **unit not stated** (ambiguous schema revision 2) | Reserved 4, **unit each** (corrected field definition) | Reservations can be subtracted in individual units |
| Catalog (`http://127.0.0.1:63156/catalog/part-19`) | `units_per_case` **null**, schema revision 1; pointed at `depot://supplier/lot-k` | `units_per_case` **6**, schema revision 2; no supplier lot reference | Case on-hand converts to individual units without external lot read |
| Supplier lot (`depot://supplier/lot-k`) | Permission denied | **Not found** | No longer required; packaging is fully on the catalog record |
| Prior decision | **Hold** (unknown net position) | **Replenish** (defensible net = 32) | Threshold crossed |

## Policy threshold (local)

From `docs/policy.md`:

- Recommend replenishment only when **available minus reserved** is **below 60 individual units**.
- At **exactly 60**, hold steady (no replenishment).
- Convert **cases** only using **current lot-specific units per case**.
- **Unknown conversion or reservation units** → hold pending clarification.
- **Current connected records supersede cached exports.**

## Evidence

### Current stock (`depot://stock/west`)

| Field | Value |
| --- | --- |
| SKU | PART-19 |
| Available | **6** |
| Unit | **case** |
| Record time | 2026-10-09T09:00:00Z |
| Authority | Current authoritative stock (**schema revision 2**; corrected bytes supersede prior revision 1 payload) |

### Current reservations (`depot://reservations/west`)

| Field | Value |
| --- | --- |
| SKU | PART-19 |
| Reserved quantity | 4 |
| Unit | **each** (corrected authoritative field definition, schema revision 2) |

### Packaging / conversion (`http://127.0.0.1:63156/catalog/part-19`)

| Field | Value |
| --- | --- |
| SKU | PART-19 |
| `units_per_case` | **6** |
| Catalog `unit` | each |
| Authority | Current lot-specific catalog (**schema revision 2**) |
| Related reference | None (prior lot-k link removed from catalog) |

### Net position (policy calculation)

| Step | Value |
| --- | --- |
| Available in individual units | 6 cases × 6 units/case = **36** |
| Reserved (individual units) | **4** |
| **Net (available − reserved)** | **32** |
| Threshold | Replenish when net **&lt; 60** → **32 qualifies** |

### Superseded cache (not used for decision)

`docs/cached.json` (observed 2026-10-09T09:00:00Z, status: superseded cached export) shows PART-19 at 72 available and 12 reserved in **each** (60 net, hold steady). Connected records now differ: 6 **cases** on hand with 4 **each** reserved and catalog case size 6. The cache remains misleading for same-day decisions.

### Supplier lot (not used)

`depot://supplier/lot-k` is **not found** in this session. Packaging no longer depends on it because `units_per_case` is populated on the current catalog response.

## Reasoning

1. **Conversion resolved:** 6 cases at 6 units per case yields 36 individual units available.
2. **Reservation unit resolved:** 4 reserved in **each** subtracts directly from individual-unit available.
3. **Net below threshold:** 32 &lt; 60 triggers replenishment under policy (not hold steady).
4. **Authoritative source order:** Connected stock, reservations, and catalog supersede `docs/cached.json`.

## Remaining questions (non-blocking for PART-19 today)

1. **Are there other SKUs or reservations at West** that should be rolled into a depot-wide replenishment decision, or is PART-19 the sole driver today?
2. **Should replenishment consider in-transit or inbound** not reflected in `depot://stock/west`?

## Suggested next steps (information only — no orders authorized)

1. Confirm depot-wide scope (PART-19 only vs. full West replenishment list).
2. Execute replenishment per local ordering process; target bringing net individual position back above the 60-unit hold band as operations defines.

## Source index

| URI / path | Role |
| --- | --- |
| `depot://stock/west` | Authoritative on-hand |
| `depot://reservations/west` | Authoritative reservations |
| `docs/policy.md` | Replenishment rule |
| `http://127.0.0.1:63156/catalog/part-19` | Case conversion |
| `docs/cached.json` | Superseded; not decision basis |
| `depot://supplier/lot-k` | Not found; not required for current catalog |
