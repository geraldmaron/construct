<!--
skills/architecture/caching.md — Caching — Use this skill when designing caching strategies for applications, APIs, or infr

Use this skill when designing caching strategies for applications, APIs, or infrastructure. ## Cache Layers
-->
# Caching

Use this skill when designing caching strategies for applications, APIs, or infrastructure.

## Cache Layers

| Layer | Tool | Latency | Use Case |
|---|---|---|---|
| In-process | HashMap, LRU cache | <1ms | Hot config, computed values |
| Distributed | Redis, Memcached | 1-5ms | Session data, query results |
| CDN | Cloudflare, CloudFront | 10-50ms | Static assets, public API responses |
| Browser | Cache-Control headers | 0ms | Assets, API responses for single user |

## Cache Strategies

### Cache-Aside (Lazy Loading)
1. Check cache. If hit, return.
2. If miss, read from database.
3. Write result to cache with TTL.
- Best for: read-heavy workloads with tolerant staleness
- Risk: thundering herd on cache miss for hot keys

### Write-Through
1. Write to cache and database simultaneously.
- Best for: data that must be fresh immediately after write
- Risk: higher write latency

### Write-Behind (Write-Back)
1. Write to cache immediately.
2. Asynchronously flush to database.
- Best for: high write throughput with acceptable durability risk
- Risk: data loss if cache fails before flush

### Read-Through
1. Cache itself fetches from database on miss.
- Best for: simplifying application code
- Requires a cache library that supports origin fetch

## Cache Invalidation

- **TTL-based**: set expiry on every key; simplest, but data can be stale up to TTL
- **Event-based**: invalidate on write events; lowest staleness, requires pub/sub
- **Version-based**: include version in cache key; new version = automatic miss
- **Tag-based**: group related keys by tag; invalidate all keys with a tag at once

### Thundering Herd Mitigation
- Lock on miss: only one request fetches, others wait
- Stale-while-revalidate: serve stale data while background refresh runs
- Early expiry jitter: randomize TTL to avoid synchronized expiry

## Redis Patterns

- Use appropriate data structures: strings for simple values, hashes for objects, sorted sets for leaderboards
- Set `maxmemory-policy` to `allkeys-lru` or `volatile-lru`
- Use pipelining for batch operations
- Monitor hit rate: target >90% for hot paths
- Use Redis Cluster for horizontal scaling
- Avoid large keys (>1MB) and hot keys (>10K ops/sec on single key)

## CDN Configuration

- Cache static assets with long TTL (1 year) and content-hash filenames
- Cache public API responses with short TTL (30-300s)
- Use `Vary` header correctly for content negotiation
- Purge on deploy for assets without content hashing
- Use edge functions for personalization at the CDN layer

## HTTP Cache Headers

```
Cache-Control: public, max-age=31536000, immutable    # hashed assets
Cache-Control: private, no-cache                       # user-specific
Cache-Control: public, s-maxage=60, stale-while-revalidate=300
ETag: "abc123"                                         # conditional requests
```

- `no-cache` means revalidate, not no caching
- `no-store` means truly do not cache
- Use `ETag` + `If-None-Match` for conditional requests

## Monitoring

- Cache hit rate per key prefix
- Eviction rate and memory usage
- Latency percentiles: p50, p95, p99
- Cache size growth over time
- Staleness: time between data change and cache update
- Alert on hit rate drop below threshold (e.g., <80%)

## Anti-Patterns

- Caching without TTL (unbounded growth)
- Caching errors or empty results without short TTL
- Cache key collisions from insufficient namespacing
- Serializing large objects when only a field is needed
- Using cache as primary data store without durability plan
