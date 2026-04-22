<!--
skills/architecture/api-design.md — API Design — Use this skill when designing REST, GraphQL, or gRPC APIs.

Use this skill when designing REST, GraphQL, or gRPC APIs. ## REST Design Principles
-->
# API Design

Use this skill when designing REST, GraphQL, or gRPC APIs.

## REST Design Principles

### Resource Naming
- Use plural nouns: `/users`, `/orders`, `/products`
- Nest for relationships: `/users/{id}/orders`
- Limit nesting to two levels; use query params for deeper filtering
- Use kebab-case for multi-word paths: `/order-items`
- Avoid verbs in URLs; let HTTP methods express the action

### HTTP Methods
- GET: read, idempotent, cacheable
- POST: create, not idempotent
- PUT: full replace, idempotent
- PATCH: partial update, idempotent
- DELETE: remove, idempotent

### Status Codes
- 200 OK: successful read or update
- 201 Created: successful creation, include Location header
- 204 No Content: successful delete
- 400 Bad Request: validation failure
- 401 Unauthorized: missing or invalid authentication
- 403 Forbidden: authenticated but not authorized
- 404 Not Found: resource does not exist
- 409 Conflict: state conflict (duplicate, version mismatch)
- 429 Too Many Requests: rate limited
- 500 Internal Server Error: unhandled server failure

### Versioning
- URL path versioning (`/v1/users`) for major breaking changes
- Header versioning for minor variations
- Support at most two major versions concurrently
- Deprecation period: minimum 6 months with Sunset header

## Response Envelope

```json
{
  "data": {},
  "error": null,
  "meta": { "page": 1, "limit": 20, "total": 142 }
}
```

- Consistent structure across all endpoints
- Paginate all list endpoints; default limit 20, max 100
- Use cursor-based pagination for large or real-time datasets
- Include total count only when it is cheap to compute

## GraphQL Design

- Separate queries and mutations clearly
- Use input types for mutation arguments
- Implement connection-based pagination (Relay spec)
- Set query depth and complexity limits
- Disable introspection in production
- Use DataLoader to batch and deduplicate database queries
- Version via schema evolution, not URL versioning

## gRPC Design

- Define services and messages in `.proto` files
- Use streaming for large datasets or real-time updates
- Implement health checking service
- Set deadlines on all RPCs
- Use interceptors for auth, logging, and metrics
- Version via package namespacing

## Error Design

- Machine-readable error code (string enum, not just HTTP status)
- Human-readable message
- Field-level validation errors as an array
- Request ID for correlation
- Do not expose internal details (stack traces, SQL errors)

## Rate Limiting

- Per-user and per-IP limits
- Return `Retry-After` header with 429 responses
- Use sliding window or token bucket algorithm
- Higher limits for authenticated requests
- Separate limits for read and write operations

## Documentation

- OpenAPI 3.x spec for REST; keep it as the source of truth
- Auto-generate client SDKs from the spec
- Include request/response examples for every endpoint
- Document authentication requirements per endpoint
- Migration or upgrade note for every breaking change, reflected in the project's canonical docs surface
