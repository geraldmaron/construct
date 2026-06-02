---
name: operating-raw-data-structuring
description: "Use when: a raw dataset (CSV, TSV, JSON export, log dump) needs to be parsed, validated, and profiled into a described, trustworthy shape before analysis."
inputs: [raw-dataset]
artifactType: data-profile
---
# Raw Data Structuring

Use this skill when a raw dataset (CSV, TSV, JSON export, log dump) arrives and must be made trustworthy before anyone analyzes or charts it.

Raw data lies by omission: silent type coercions, missing values encoded three different ways, duplicated rows, and columns whose meaning no one wrote down. Structure it before trusting it.

## Steps

1. **Identify the grain.** What does one row represent (one event, one user, one day)? State it explicitly; analysis built on the wrong grain is wrong.
2. **Profile each column**: inferred type, null rate, distinct count, min/max or top values. Flag columns that are >50% null or all-distinct (likely an id) or single-valued (likely useless).
3. **Detect encoding hazards**: mixed types in one column, multiple null sentinels (`""`, `NA`, `null`, `-1`), inconsistent date formats, numbers stored as strings. List each; do not silently coerce.
4. **Check for duplicates** on the candidate key; report the duplicate rate.
5. **Describe each column** in one line — what it means, its unit, and its source if known. Where meaning is genuinely unknown, write `meaning: unknown` rather than inventing one.
6. **State what the data cannot answer** — questions that look answerable but aren't, given the grain or missingness.

## Output shape

```
## Dataset profile
- grain: <one row = …>
- rows: <n> · columns: <n> · duplicate rate: <%>

## Columns
| name | type | null% | distinct | meaning |
|---|---|---|---|---|

## Hazards
- <column>: <encoding/quality hazard>

## Out of scope
- <question the data cannot answer> — <why>
```

## Verification bar

- Every reported statistic is computed from the data, not estimated.
- Column meanings are stated only where known; unknowns are labeled `unknown`.
- Hazards are surfaced before any downstream metric is derived.
