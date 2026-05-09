---
cx_doc_id: 0002-rfc-provider-capability-matrix
created_at: 2026-04-29T00:00:00.000Z
updated_at: 2026-04-29T00:00:00.000Z
generator: construct/artifact
status: accepted
---
# RFC-0002: Provider Capability Matrix Shape

- **Date**: 2026-04-29
- **Author**: Construct·Architect
- **Status**: Accepted

## Summary

Define the exact shape of the capability matrix that all Construct providers must implement. This RFC specifies the method signatures, return types, error contract, and capability declaration format that make providers interchangeable from the core's perspective.

## Motivation

With five providers implemented (git, GitHub, Jira, Slack, Confluence) and more planned, the capability matrix needs a stable contract before providers proliferate. The contract determines:
- How core dispatches work without knowing the provider's transport
- How the registry routes capability requests
- How the contract test harness validates compliance
- How partial implementations (read-only providers) are handled

ADR-0003 made the architectural decision; this RFC defines the implementation contract in detail.

## Design

### Capability signatures

```js
// Read items by reference (ID, path, query shorthand, or filter object)
async read(ref: string | object, opts?: object) → Item[]

// Create or update an item
async write(item: object) → WriteResult

// Full-text or structured search
async search(query: string, opts?: object) → SearchResult[]

// Register a listener for real-time events (polling or webhook)
watch(event: string, handler: (event: object) => void) → unsubscribe: () => void

// Normalize an inbound webhook payload to a standard event shape
normalizeWebhook(payload: object, headers: object) → NormalizedEvent
```

### Item shape (minimum)
```js
{
  id: string,          // provider-scoped unique ID
  type: string,        // e.g. 'commit', 'pr', 'issue', 'message', 'page'
  title?: string,
  body?: string,
  url?: string,
  createdAt?: string,  // ISO 8601
  updatedAt?: string,
  raw: object,         // original provider response, unmodified
}
```

### WriteResult shape
```js
{ id: string, url?: string, raw: object }
```

### Capability declaration
Each provider exports a `capabilities` array listing what it supports:
```js
export const capabilities = ['read', 'search', 'write', 'watch', 'webhook'];
```

Unsupported capabilities **must not** be listed. Core uses `hasCapability(provider, cap)` before dispatching. Calling an unsupported capability throws `CapabilityNotSupported`.

### Error hierarchy
```
ProviderError (base)
├── CapabilityNotSupported
├── AuthError
├── RateLimitError  { retryAfter?: number }
└── NotFoundError
```

All errors extend `ProviderError` and include `{ providerName, capability, message }`.

### Contract test harness
`providers/lib/contract-tests.mjs` exports `runContractTests(provider)` which:
1. Validates `provider.name` (string, non-empty)
2. Validates `provider.capabilities` (array, subset of known caps)
3. For each declared capability, verifies the method exists and returns a Promise
4. Verifies undeclared capabilities throw `CapabilityNotSupported`

Providers run `runContractTests` in their test suite to prove compliance.

## Drawbacks

- `read(ref)` is intentionally generic — providers interpret `ref` differently (git SHA vs Jira issue key vs Slack channel ID). This flexibility makes cross-provider code harder to write.
- `watch` uses polling internally for most providers; true push requires webhook infrastructure (Phase 5).
- No pagination contract — providers return arrays directly. Large result sets require `opts.limit` / `opts.cursor` conventions that are currently informal.

## Alternatives

### RPC-style interface (one method per resource type)
`readCommit`, `readPR`, `createIssue`, etc. Rejected: explosion of methods per provider; impossible to add a new provider without touching core.

### GraphQL-style query object
`provider.query({ type: 'pr', filter: {...} })`. Rejected: over-engineered for the current use cases; hard to implement consistently across REST, CLI, and SDK transports.

### OpenAPI spec per provider
Rejected: too heavyweight; providers change frequently in early development; spec drift is worse than no spec.

## Unresolved questions

- Should `read` return a single Item when ref is an ID, or always an array? Currently always array — reconsider if single-item lookup becomes common.
- Pagination: should `opts.cursor` / `opts.limit` be formalized in the contract test harness?
- Should `write` support a `patch` operation distinct from `create`?
