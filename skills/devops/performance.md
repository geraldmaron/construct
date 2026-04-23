<!--
skills/devops/performance.md — Performance Engineering — Use this skill when profiling, load testing, or optimizing application and infra

Use this skill when profiling, load testing, or optimizing application and infrastructure performance. ## Performance Targets
-->
# Performance Engineering

Use this skill when profiling, load testing, or optimizing application and infrastructure performance.

## Performance Targets

Define targets before optimizing. Measure against real user experience.

| Metric | Web Target | API Target |
|---|---|---|
| p50 latency | <200ms | <50ms |
| p95 latency | <1s | <200ms |
| p99 latency | <3s | <500ms |
| Throughput | - | Define per endpoint |
| Error rate | <0.1% | <0.1% |

## Profiling

### Application Profiling
- CPU profiling: identify hot functions and call paths
- Memory profiling: find leaks, excessive allocations, and retention
- Trace profiling: follow requests across service boundaries
- Flame graphs for visual analysis of CPU and memory usage
- Profile in production or with production-like data; synthetic benchmarks mislead

### Database Profiling
- Slow query log (threshold: 100ms)
- EXPLAIN ANALYZE on suspect queries
- Index usage statistics
- Connection pool utilization
- Lock contention and wait events

### Network Profiling
- DNS resolution time
- TLS handshake time
- Time to first byte (TTFB)
- Payload size and compression effectiveness
- Connection reuse and keep-alive behavior

## Load Testing

### Types
- **Smoke**: minimal load to verify the system works (1-5 users)
- **Load**: expected production traffic to establish baseline
- **Stress**: beyond expected traffic to find the breaking point
- **Soak**: sustained load for hours to find leaks and degradation
- **Spike**: sudden traffic burst to test auto-scaling and recovery

### Tools
- k6, Gatling, Locust, Artillery, or JMeter
- Script realistic user journeys, not just single endpoints
- Ramp up gradually; sudden jumps obscure bottleneck identification
- Run against an environment isolated from production
- Collect metrics from application, database, and infrastructure during tests

### Analysis
- Identify the bottleneck: CPU, memory, I/O, network, database, external service
- Fix one bottleneck at a time; re-measure after each fix
- Document baseline metrics before optimization
- Compare before and after with statistical significance

## Optimization Techniques

### Application
- Cache expensive computations and repeated queries
- Use connection pooling for databases and HTTP clients
- Batch operations instead of sequential calls
- Async processing for non-blocking work
- Precompute and materialize frequently accessed derived data

### Database
- Optimize queries before adding hardware
- Add indexes for slow queries (EXPLAIN first)
- Use read replicas for read-heavy workloads
- Partition large tables by time or tenant
- Archive old data to reduce active dataset size

### Infrastructure
- Right-size instances based on actual utilization
- Auto-scale based on leading indicators (queue depth, CPU trend)
- Use CDN for static content and cacheable API responses
- Place compute close to data to reduce network latency
- Compress responses (gzip, brotli, zstd)

## Monitoring for Performance

- Track p50, p95, p99 latency per endpoint
- Monitor error rate alongside latency
- Set SLOs and alert on burn rate, not individual breaches
- Dashboard: latency, throughput, error rate, saturation (CPU, memory, connections)
- Compare metrics week-over-week to detect gradual degradation

## Anti-Patterns

- Optimizing without profiling (guessing the bottleneck)
- Premature optimization of code that runs rarely
- Caching without invalidation strategy
- Adding resources instead of fixing the root cause
- Micro-benchmarks that do not reflect production workloads
