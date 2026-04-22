<!--
skills/devops/data-engineering.md — Data Engineering — 1. **Idempotency**: pipelines can run multiple times without duplicating data

## Core Principles 1. **Idempotency**: pipelines can run multiple times without duplicating data
-->
# Data Engineering

## Core Principles

1. **Idempotency**: pipelines can run multiple times without duplicating data
2. **Observability**: every pipeline run logs row counts, latency, and anomalies
3. **Data contracts**: producers and consumers agree on schema and SLAs
4. **Lineage**: know where every column came from and what it feeds

## Pipeline Patterns

### ELT over ETL

Modern data platforms (BigQuery, Snowflake, Redshift) are powerful enough to transform inside the warehouse. Prefer **ELT** (Extract → Load raw → Transform in warehouse):

```
Source → Airbyte/Fivetran → Raw tables → dbt models → Mart/API
```

**ETL** (transform before loading) is still appropriate for:
- PII masking before data leaves the source system
- Extremely large aggregations that reduce volume significantly
- Real-time streaming with latency constraints

### Batch pipelines

Use **Apache Airflow** or **Prefect** for orchestration:

```python
@dag(schedule="@daily", start_date=pendulum.datetime(2024, 1, 1), catchup=False)
def orders_pipeline():
  raw = extract_orders()
  validated = validate_orders(raw)
  loaded = load_to_warehouse(validated)
  transform_dbt_models(loaded)
```

- `catchup=False` prevents backfilling missed runs on deploy
- Idempotent tasks: use `INSERT OVERWRITE` / `MERGE` instead of `INSERT`
- Partition by date and process one partition at a time

### Streaming pipelines

Use **Apache Kafka** + **Flink** or **Spark Structured Streaming** for sub-minute latency:

```python
# Flink example (PyFlink)
env = StreamExecutionEnvironment.get_execution_environment()
stream = env \
  .from_source(kafka_source, WatermarkStrategy.no_watermarks(), "Kafka") \
  .map(parse_event) \
  .filter(lambda e: e.type == "order_placed") \
  .sink_to(warehouse_sink)
env.execute("Orders Streaming Pipeline")
```

Watermarks define event-time handling for late-arriving events — configure based on source latency SLA.

## Data Modeling

### Kimball dimensional model (warehouses)

```sql
-- Fact table: measurements/events at grain
CREATE TABLE fct_orders (
  order_id        BIGINT PRIMARY KEY,
  customer_sk     BIGINT REFERENCES dim_customer(sk),
  product_sk      BIGINT REFERENCES dim_product(sk),
  ordered_at      TIMESTAMP,
  amount_usd      NUMERIC(12,2)
);

-- Dimension: slowly changing attribute context
CREATE TABLE dim_customer (
  sk              BIGINT PRIMARY KEY,    -- surrogate key
  customer_id     VARCHAR NOT NULL,      -- natural key
  name            VARCHAR NOT NULL,
  tier            VARCHAR,
  valid_from      TIMESTAMP NOT NULL,
  valid_to        TIMESTAMP,             -- NULL = current
  is_current      BOOLEAN DEFAULT TRUE
);
```

- Facts are narrow (IDs + measures)
- Dimensions are wide (all attributes about an entity)
- Slowly Changing Dimension Type 2 (SCD2) tracks historical state via `valid_from`/`valid_to`

### dbt for transformations

```sql
-- models/marts/fct_orders.sql
WITH source AS (
  SELECT * FROM {{ ref('stg_orders') }}
),
validated AS (
  SELECT * FROM source WHERE amount_usd > 0
)
SELECT
  order_id,
  customer_id,
  {{ dbt_utils.generate_surrogate_key(['customer_id']) }} AS customer_sk,
  ordered_at,
  amount_usd
FROM validated
```

- `ref()` builds the DAG automatically
- `source()` for raw tables with freshness assertions
- Add `dbt test` assertions: `not_null`, `unique`, `accepted_values`, `relationships`
- `dbt docs generate && dbt docs serve` for lineage UI

## Data Quality

### At ingestion

- Schema validation: reject records that don't match expected types/nullability
- Volume checks: alert if row count deviates > 20% from trailing 7-day average
- Freshness: alert if source hasn't updated within its SLA window

### At transformation

```yaml
# dbt tests in schema.yml
models:
  - name: fct_orders
    columns:
      - name: order_id
        tests: [unique, not_null]
      - name: amount_usd
        tests:
          - not_null
          - dbt_utils.accepted_range:
              min_value: 0
```

### Great Expectations (standalone)

```python
context.sources.add_pandas_filesystem(name="orders", base_directory="data/")
validator = context.get_validator(batch_request=..., expectation_suite_name="orders")
validator.expect_column_values_to_not_be_null("order_id")
validator.expect_column_values_to_be_between("amount_usd", min_value=0)
validator.save_expectation_suite()
```

## Data Contracts

Define and enforce schema agreements between producers and consumers:

```yaml
# contract: orders-v1.yaml
name: orders
version: 1
schema:
  - name: order_id
    type: string
    nullable: false
  - name: amount_usd
    type: number
    nullable: false
sla:
  freshness: 1h
  availability: 99.5%
```

Tools: **Soda Core**, **DataHub**, **OpenLineage** for lineage tracking.

## Common Pitfalls

- **No idempotency**: `INSERT` without `ON CONFLICT` or partition-replace duplicates rows on reruns
- **Wide tables**: adding columns to fact tables without versioning breaks downstream models
- **Missing backfill strategy**: pipelines without `catchup` support can't recover historical data gaps
- **Unmonitored late data**: streaming jobs without watermarks silently drop late events
- **Schema evolution without contracts**: upstream changes break downstream models silently
- **Full table scans**: no partition pruning on fact tables causes escalating costs
