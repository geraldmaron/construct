# Runbook: ACP Host Verification Matrix

- **Service**: `lib/acp/server.mjs` (Agent Client Protocol server)
- **Conformance tests**: `tests/acp/conformance.test.mjs`, `tests/functional/acp-server.functional.test.mjs`
- **Owner**: operator
- **Last tested**: 2026-07-20
- **Severity**: SEV-3 (protocol evidence; runtime behavior is unchanged by this matrix)

## What this matrix records

Construct implements ACP as a newline-delimited JSON-RPC 2.0 server on stdio
(`initialize`, `session/new`, `session/prompt`, `session/cancel`; progress via
`session/update`). The matrix below records which real ACP **host clients** have
been exercised against this implementation. It is separate from the automated
protocol conformance suite, which certifies message shapes against the real
server entrypoint without claiming a specific editor was used.

Verification methods:

- **automated** — CI runs `node --test tests/acp/conformance.test.mjs` and/or
  spawns `construct acp` in `tests/functional/acp-server.functional.test.mjs`.
- **manual** — a human drove a real host client against `construct acp` and
  recorded the outcome.
- **unverified** — no live host session recorded; Construct does not claim
  supported status for that host.

## Host matrix

| Host | ACP protocol version | Status | Verification method | Notes |
|---|---|---|---|---|
| Zed | 1 | unverified | none | Protocol conformance is automated; no live Zed session recorded in CI. |
| JetBrains | 1 | unverified | none | Protocol conformance is automated; no live JetBrains session recorded in CI. |
| VS Code ACP client | 1 | unverified | none | `lib/host/readiness.mjs` covers VS Code MCP config readiness separately (construct-tsyfe.9.4); that axis is not an ACP host verification. |

## Running protocol conformance

```bash
node --test tests/acp/conformance.test.mjs
node --test tests/functional/acp-server.functional.test.mjs
```

## Updating this matrix

When a real host session is exercised:

1. Record the host, protocol version, and verification method (`manual`).
2. Set status to `verified` only when the session completed initialize →
   session/new → session/prompt without spec-shape errors.
3. Use `known-gap` when a host-specific limitation is confirmed (describe the
   gap in Notes).
4. Never mark `verified` without stating the verification method.

## Related beads

- construct-tsyfe.9.3 (this matrix + conformance suite)
- construct-tsyfe.9.7 (packed-artifact rollup consumes ACP surface presence)
