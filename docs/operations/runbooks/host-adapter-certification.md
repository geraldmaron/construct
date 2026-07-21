# Runbook: Host-Adapter Certification (harness classification + VS Code/Copilot readiness)

- **Service**: `lib/certification/host-adapter-certification.mjs`
- **Owner**: operator
- **Last tested**: 2026-07-20
- **Severity**: SEV-3 (advisory evidence tooling; no runtime behavior depends on it)

## What this module proves

Construct has two distinct, non-interchangeable host-detection mechanisms:

- `lib/host-capabilities.mjs` — per-host harness classification (Claude Code,
  OpenCode, Codex, VS Code, Cursor, Copilot): is a binary installed, and was
  it actually executed to confirm that (`probe: live|artifacts-only|absent`)?
- `lib/host/readiness.mjs` — VS Code/Copilot host-config readiness
  (`missing_config` through `healthy`, plus four runtime-only states:
  `untrusted`, `server_start_failure`, `missing_tool`, `sandbox_disabled`
  that its own header states require a live host session).

Before construct-tsyfe.9.4, neither mechanism had a certification record. This
module records one evidence entry per detection target, tagged with its axis
(`harness-classification` or `vscode-copilot-readiness`, never merged) and its
verification method:

- `live` — a host binary actually executed in this process, a live MCP probe
  against real `.vscode/mcp.json` observed a runtime state, or a human attests
  to a real host session.
- `simulated` — the real classifier ran against constructed fixtures or a
  fabricated runtimeState with no live observation.

## Running it

```bash
node lib/certification/host-adapter-certification.mjs
```

Prints both axes as JSON with `probeLiveRuntime: true`. Run inside a real
Claude Code session and the Claude Code harness record is genuinely `live`.

Programmatic use:

```js
import { collectAllHostAdapterEvidence } from './lib/certification/host-adapter-certification.mjs';
const evidence = await collectAllHostAdapterEvidence({ probeLiveRuntime: true });
```

## Live runtime-only readiness evidence

The four runtime-only VS Code readiness codes cannot be inferred from static
analysis alone. This module supports two live paths:

1. **MCP probe (automated)** — `probeVscodeMcpRuntimeState()` performs a real
   MCP handshake against the Construct MCP server entry in `.vscode/mcp.json`.
   A failed handshake maps to `server_start_failure`; an empty tools list maps
   to `missing_tool`. Pass `probeLiveRuntime: true` to
   `collectAllHostAdapterEvidence()`.

2. **Human attestation (manual)** — when a real VS Code GUI session is
   available but the probe cannot observe the state:

```js
import { recordRuntimeReadinessEvidence } from './lib/certification/host-adapter-certification.mjs';

const record = recordRuntimeReadinessEvidence({
  reasonCode: 'untrusted',
  attestation: {
    attestedBy: 'your name',
    attestedAt: new Date().toISOString(),
    sessionEvidence: 'describe exactly what you observed in the real VS Code session',
  },
});
```

An attestation with any required field missing falls back to `simulated`.

## Startup-to-invocation context

id:construct-0h5r0 (closed 2026-07-20) — startup-to-invocation runbook lives at
docs/operations/runbooks/orchestration-startup-to-invocation.md. Cross-reference that
file for the general onboarding path.

## Wiring

Not wired into any CI gate. Run on demand or as part of a real-host
certification pass. Unit coverage:
`tests/certification/host-adapter-certification.test.mjs`.

## References

- construct-tsyfe.9.4 (this module)
- `lib/host-capabilities.mjs`, `lib/host/readiness.mjs`
- `lib/certification/evidence-tiers.mjs`
- id:construct-0h5r0 (startup-to-invocation runbook, closed — see orchestration-startup-to-invocation.md)
