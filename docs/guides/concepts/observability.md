---
title: Observability
description: OpenTelemetry GenAI traces, span instrumentation, and consumer integration.
---

# Observability

Construct emits OpenTelemetry spans for every LLM call, embedding operation, and MCP tool invocation when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Without an endpoint configured, telemetry is zero-cost (no-op tracer, no network calls).

## Local-only mode (default)

No setup required. Skill load events land in `~/.construct/skill-calls.jsonl`. Query them:

```bash
construct skills usage --since=30d
construct skills hot --limit=20
construct telemetry query latency --p=95 --since=24h
```

## Enabling OTel traces

Set `OTEL_EXPORTER_OTLP_ENDPOINT` in your environment or `.env`:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://your-endpoint/v1/traces
```

Construct defaults to `gen_ai_latest_experimental` semconv. Override with `OTEL_SEMCONV_STABILITY_OPT_IN`.

## Two telemetry layers, one agnostic stance

Construct is **vendor-agnostic by design** — no backend is hard-wired into the data plane.

- **Live spans** (above): the OTel SDK tracer (`lib/telemetry/otel-tracer.mjs`) exports GenAI spans over
  OTLP to any endpoint set via `OTEL_EXPORTER_OTLP_ENDPOINT`.
- **Trace capture/export** (`lib/telemetry/client.mjs`): local JSONL by default; the remote backend is
  chosen with `CONSTRUCT_TRACE_BACKEND` — `local` (default), `otel`, `http`, `langfuse`, or `none`. For
  OTLP batch export set `CONSTRUCT_TRACE_BACKEND=otel` and `CONSTRUCT_OTEL_EXPORTER_OTLP_ENDPOINT`.

Langfuse is **one OTLP consumer among many**, selected only when Langfuse-style keys
(`CONSTRUCT_TELEMETRY_PUBLIC_KEY` / `_SECRET_KEY`) are present; a bare `CONSTRUCT_TELEMETRY_URL` uses the
generic `http` backend. The bundled local Langfuse stack is a convenience, not a dependency — point either
layer at Tempo, Honeycomb, Jaeger, Datadog, or any OTLP collector instead.

## Consumer integrations

### Langfuse

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://cloud.langfuse.com/api/public/otel/v1/traces
OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic <base64-public:secret>"
```

### Honeycomb

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io/v1/traces
OTEL_EXPORTER_OTLP_HEADERS="x-honeycomb-team=<api-key>"
```

### Grafana Tempo

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tempo-instance>/otlp/v1/traces
OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic <base64-user:token>"
```

### Datadog AI Observability

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://trace.agent.datadoghq.com/api/v0.2/traces
DD_API_KEY=<your-key>
```

## Span attributes

Every LLM and embedding span carries the stable OTel GenAI attributes:

| Attribute | Example value |
|-----------|---------------|
| `gen_ai.system` | `anthropic` |
| `gen_ai.operation.name` | `chat`, `embeddings` |
| `gen_ai.request.model` | `claude-3-5-sonnet` |
| `gen_ai.usage.input_tokens` | `1250` |
| `gen_ai.usage.output_tokens` | `340` |
| `gen_ai.response.finish_reasons` | `["stop"]` |

MCP tool call spans also carry:

| Attribute | Example value |
|-----------|---------------|
| `gen_ai.tool.name` | `get_skill` |
| `mcp.method.name` | `mcp__construct__get_skill` |
| `mcp.transport` | `stdio` |

## W3C trace propagation across MCP

Persona-to-specialist dispatches inject `traceparent` into `params._meta` per SEP-414. The specialist MCP handler extracts it and creates a child span, so the full persona-to-tool chain appears as one connected trace tree in your backend.

## Audit trail (tamper-evidence)

Every mutation Construct or a dispatched subagent makes (Edit, Write, MultiEdit, NotebookEdit, and state-mutating Bash) is appended to `.construct/audit-trail.jsonl` by the `audit-trail` PostToolUse hook. Each record carries a `prev_line_hash` — the SHA-256 of the previous line — so any after-the-fact reorder, deletion, or edit breaks the chain.

```bash
construct audit trail            # recent records
construct audit trail --verify   # replay the chain and report breaks
```

A serial hash chain cannot survive concurrent appends, so the hook computes `prev_line_hash` and appends inside a single cross-process file lock (`appendAuditRecord` in `lib/audit-trail.mjs`); parallel hook, daemon, and same-session tool processes are serialized rather than racing off a shared predecessor.

### Re-basing the chain

A chain that was damaged before serialization existed cannot be re-derived. `construct audit trail --reset --reason="…"` writes a `chain_reset` boundary line: records ahead of the most recent boundary are sealed as immutable legacy and exempted from verification, and the live chain re-bases from the boundary. `--verify` then validates only the live segment, while tampering after the boundary is still caught.

## Disabling

```bash
CONSTRUCT_OTEL=off
```

Or simply leave `OTEL_EXPORTER_OTLP_ENDPOINT` unset.
