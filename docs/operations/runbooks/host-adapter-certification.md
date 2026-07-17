# Runbook: Host-Adapter Certification (harness classification + VS Code/Copilot readiness)

- **Service**: `lib/certification/host-adapter-certification.mjs`
- **Owner**: operator
- **Last tested**: 2026-07-17
- **Severity**: SEV-3 (advisory evidence tooling; no runtime behavior depends on it)

## What this module proves

Construct has two distinct, non-interchangeable host-detection mechanisms:

- `lib/host-capabilities.mjs` — per-host harness classification (Claude Code,
  OpenCode, Codex, VS Code, Cursor, Copilot): is a binary installed, and was
  it actually executed to confirm that (`probe: live|artifacts-only|absent`)?
- `lib/host/readiness.mjs` — VS Code/Copilot host-config readiness
  (`missing_config` through `healthy`, plus four runtime-only states —
  `untrusted`, `server_start_failure`, `missing_tool`, `sandbox_disabled` —
  that its own header states require a live host session).

Before construct-tsyfe.9.4, neither mechanism had a certification record: a
detection regression in either module shipped silently, and "Construct works
in host X" rested on code review, not observed evidence. This module records
one evidence entry per detection target, tagged with its axis
(`harness-classification` or `vscode-copilot-readiness` — the two are never
merged into one host-supported flag) and its verification method:

- `live` — a host binary actually executed in this process, or a human
  explicitly attests to a real host session.
- `simulated` — the real classifier function ran, but against a config-file
  signal with no binary confirmed, or a constructed on-disk fixture, not an
  observed live session.

## Running it

```bash
node lib/certification/host-adapter-certification.mjs
```

Prints both axes' evidence as JSON. Run inside a real Claude Code session and
the "Claude Code" harness record is genuinely `live` — the classifier
executes the real `claude` binary check in this process, not a mock.

For programmatic use:

```js
import { collectAllHostAdapterEvidence } from './lib/certification/host-adapter-certification.mjs';
const evidence = collectAllHostAdapterEvidence();
```

## Scope boundary: what this does NOT prove today

The four runtime-only VS Code readiness codes (`untrusted`,
`server_start_failure`, `missing_tool`, `sandbox_disabled`) cannot be
inferred from static analysis — `lib/host/readiness.mjs`'s own header states
they require a live host session. `construct doctor`'s only call site for
`classifyHostReadiness` (`bin/construct`) never passes a `runtimeState`
today, so no code path anywhere in the product currently observes these four
states from a real VS Code session. Until that wiring exists (a separate,
out-of-scope change per construct-tsyfe.9.4's Decision — this bead adds
certification/evidence tooling, not adapter logic), the only way to promote
one of these four to `live` evidence is an explicit human attestation:

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

An attestation with any of the three fields missing is not accepted as live
— `recordRuntimeReadinessEvidence` falls back to `simulated` rather than
silently trusting a partial claim.

## Diagnostic steps

```mermaid
flowchart TD
  A[Evidence looks wrong] --> B{Which axis?}
  B -->|harness-classification| C[Check lib/host-capabilities.mjs detectHostCapabilities/hostProbe]
  B -->|vscode-copilot-readiness| D[Check lib/host/readiness.mjs classifyHostReadiness resolution order]
  C --> E{live vs simulated wrong for a host?}
  E -->|yes| F[Check the raw signal — commandVersion()/fs.existsSync() calls in detectHostRawSignals]
  D --> G{static code vs runtime-only code?}
  G -->|static| H[Check the on-disk fixture in buildStaticReadinessFixtures matches the intended state]
  G -->|runtime-only| I[Confirm no attestation was supplied if you expected simulated, or that all three attestation fields were supplied if you expected live]
```

## Startup-to-invocation context

id:construct-0h5r0 (open at time of writing, P3) tracks a general
startup-to-successful-orchestration-invocation runbook. This runbook does not
duplicate that broader scope — it is scoped to host-adapter certification
only. Once construct-0h5r0 ships its runbook, cross-reference it here instead
of re-documenting session startup.

## Wiring

Not wired into any CI gate — this is evidence-generation tooling, run
on demand or as part of a real-host certification pass, not a pass/fail
release gate. Unit coverage: `tests/certification/host-adapter-certification.test.mjs`.

## References

- construct-tsyfe.9.4 (this module)
- `lib/host-capabilities.mjs`, `lib/host/readiness.mjs` (the two certified modules)
- `lib/certification/evidence-tiers.mjs`, `lib/certification/provider-evidence-tiers.mjs` (the sibling evidence-tier modules this module's shape follows, per ADR-0090)
- `docs/decisions/adr/0090-provider-certification-ladder.md` ("reuse the pattern, not the function" precedent)
- id:construct-0h5r0 (startup-to-invocation runbook, open — cross-reference once shipped)
