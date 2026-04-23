<!--
skills/devops/database.md — Database Patterns — Use this skill when designing schemas, writing migrations, optimizing queries, o

Use this skill when designing schemas, writing migrations, optimizing queries, or selecting databases. ## Schema Design
-->
# Database Patterns

Use this skill when designing schemas, writing migrations, optimizing queries, or selecting databases.

## Schema Design

### Relational
- Normalize to 3NF by default; denormalize deliberately for read performance
- Every table has a primary key; prefer UUID or ULID for distributed systems
- Foreign keys enforced at the database level
- Use appropriate column types; avoid stringly-typed data
- Add `created_at` and `updated_at` timestamps to all entities
- Soft delete (`deleted_at`) when audit trail matters

### Document (NoSQL)
- Model for access patterns, not entity relationships
- Embed data that is read together
- Reference data that changes independently or is shared
- Avoid deeply nested documents (>3 levels)
- Define a schema even when the database does not enforce one

## Indexing

### When to Index
- Columns in WHERE, JOIN, ORDER BY, and GROUP BY clauses
- Foreign key columns (often missed)
- Columns used in unique constraints

### Index Types
- B-tree: default, good for equality and range queries
- Hash: equality only, faster for point lookups
- GIN/GiST: full-text search, JSONB, arrays, geometric data
- Partial index: index only rows matching a condition
- Composite index: column order matters; most selective first

### Anti-Patterns
- Indexing every column (write overhead, storage waste)
- Unused indexes (monitor with `pg_stat_user_indexes` or equivalent)
- Missing index on foreign keys (causes slow joins and cascading deletes)

## Query Optimization

- Always EXPLAIN queries before and after optimization
- Avoid `SELECT *`; specify only needed columns
- Use pagination: LIMIT + OFFSET for small datasets, cursor-based for large
- Avoid N+1 queries: use JOINs, batch fetches, or DataLoader pattern
- Use CTEs for readability; materialize only when the planner needs help
- Parameterize queries; never interpolate user input

## Migrations

### Principles
- Every schema change is a versioned migration
- Migrations are forward-only in production; rollback via new forward migration
- Test migrations against a copy of production data
- Separate schema changes from data migrations
- Deploy additive schema changes before code changes

### Safe Practices
- Add columns as nullable or with defaults; never add NOT NULL without a default
- Add indexes concurrently (`CREATE INDEX CONCURRENTLY` in PostgreSQL)
- Rename via add-new, migrate-data, remove-old (three deployments)
- Drop columns only after all code references are removed
- Lock-free migrations for high-traffic tables

## Connection Management

- Use connection pooling (PgBouncer, HikariCP, or ORM-level)
- Set pool size based on: CPU cores x 2 + disk spindles (for PostgreSQL)
- Set connection timeout and idle timeout
- Monitor active, idle, and waiting connections
- Close connections cleanly; handle connection loss gracefully

## Backup and Recovery

- Automated daily backups with point-in-time recovery
- Test restore procedure quarterly
- Backup retention: minimum 30 days
- Encrypt backups at rest and in transit
- Store backups in a different region or provider

## Monitoring

- Slow query log with threshold (100ms typical)
- Connection pool utilization
- Replication lag (for read replicas)
- Table and index bloat
- Disk usage growth rate
- Lock contention and deadlock frequency
- Alert on: replication lag >10s, connection pool >80%, slow query spike
