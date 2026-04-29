---
cx_doc_id: 0003-rfc-dashboard-chat-protocol
created_at: 2026-04-29T00:00:00.000Z
updated_at: 2026-04-29T00:00:00.000Z
generator: construct/Construct-Engineer
status: accepted
---
# RFC-0003: Dashboard Chat Protocol

- **Date**: 2026-04-29
- **Author**: Construct-Engineer
- **Status**: Accepted

## Summary

Define the HTTP protocol for the dashboard chat interface: how messages are sent, how responses are streamed, how conversation history is managed server-side, and how the server delegates to the AI backend. The protocol must work over plain HTTP/1.1 with no WebSocket dependency and no client-side build step.

## Motivation

The dashboard is a zero-dep vanilla JS SPA served from a Node http server. Chat needs to feel real-time (streaming token-by-token output) without requiring WebSockets, a bundler, or a client-side AI SDK. The server already uses SSE for live-reload; extending SSE to chat is the lowest-friction path.

The chat backend must:
- Delegate to the claude --print CLI rather than importing an SDK (respects ADR-0001 zero-dep core constraint)
- Maintain per-conversation history trimmed to a rolling window to avoid context overflow
- Degrade gracefully with actionable instructions if the CLI is absent or unauthenticated
- Be stateless between server restarts (local single-user; session persistence is Phase 5)

## Design

### Endpoints

    POST /api/chat
      Body:     { message, id? }
      Response: { id, reply }
      Non-streaming. Full JSON response. Programmatic/test access.

    GET /api/chat/stream?message=<urlencoded>&id=<convId>
      Response: text/event-stream
      Events:   data: { type, text, id }
        type = "chunk"  -- incremental text token(s) from the model
        type = "done"   -- stream complete
        type = "error"  -- fatal error, stream ending
      Streaming via EventSource. Primary dashboard path.

    GET /api/chat/history?id=<convId>
      Response: { id, messages: [{ role, content }] }
      Returns conversation history. Best-effort; cleared on server restart.

### Conversation lifecycle

1. Client sends first message with no id.
2. Server creates conversation, assigns hex ID, records user turn.
3. Server returns id in first SSE chunk event.
4. Client persists id; sends it in all subsequent requests.
5. Server trims to last 6 turns before prompt construction.
6. Conversations expire after 2 hours of inactivity (in-memory TTL).

### Prompt construction

    [Project context -- first turn only, .cx/context.md truncated to 1500 chars]

    Human: <turn 1 user message>

    Assistant: <turn 1 response>

    ... (up to 6 turns) ...

    Human: <current message>

    Assistant:

The prompt is written to the claude process stdin. The process is spawned with stdio: pipe. stdout tokens are forwarded as SSE chunk events. Process exit triggers done or error.

### CLI delegation

    spawn("claude", ["--print"], { stdio: ["pipe","pipe","pipe"] })

The server detects the claude binary via which(1) at startup. If not found, the handler returns a structured fallback message with installation instructions rather than a 500 error.

### Auth integration

Chat endpoints are behind the standard /api/* auth gate (session cookie or Bearer token). No additional auth layer needed.

## Drawbacks

- Conversation history is lost on server restart -- acceptable for local single-user; not acceptable for multi-user cloud (Phase 5 addresses with persistent session store)
- Prompt construction is naive (Human/Assistant turn format) rather than using the Messages API -- works for claude --print but may not generalize to other CLIs
- No rate limiting on chat requests -- a runaway client could spawn many claude processes; add process count limit in Phase 5
- GET with message in query string limits message length -- POST /api/chat/stream with body would be cleaner but EventSource only supports GET

## Alternatives

### WebSockets
Rejected: requires a WS library or raw frame parsing; EventSource covers the use case with less complexity.

### Server-sent events with POST (fetch + ReadableStream)
Viable, eliminates query-string length limit. Deferred: EventSource is simpler and sufficient for typical message lengths. Can migrate without breaking the event shape contract.

### Import Anthropic SDK directly
Rejected: violates ADR-0001 (zero npm deps in core). The dashboard server is core infrastructure.

### Persistent conversation store (SQLite, files)
Deferred to Phase 5 alongside multi-user session management.

## Unresolved questions

- Should message length be validated and capped server-side?
- Should the server limit concurrent claude processes (e.g. max 3)?
- Phase 5: should conversation history survive server restart via JSONL persistence at ~/.cx/chat-history.jsonl?
