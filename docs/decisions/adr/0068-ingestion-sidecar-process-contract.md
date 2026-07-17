<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0068: Ingestion sidecar process contract — one JSON-RPC surface, lazy, self-supervising

- **Date**: 2026-07-05
- **Status**: accepted
- **Deciders**: Gerald Dagher (owner)
- **Supersedes**: none
- **Relates to**: ADR-0036 (docling sidecar — the process this contract formalizes), ADR-0059 (dependency-intent rubric — `graceful-skip` degradation taxonomy this contract's doctor entry reports through), ADR-0066 (config-layer footprint — the machine-shared venv location this contract's provisioning step resolves), `lib/daemons/contract.mjs` (the analogous safeguard contract for persistent daemons, explicitly not this shape)

<!-- Owning specialist: cx-architect. -->

## Problem

The docling sidecar (`lib/document-extract/docling-sidecar.py`, spawned by `lib/document-extract/docling-client.mjs`) grew its lazy-provisioning, JSON-RPC, and degradation behavior organically across several changes, with no single document naming the shape a construct-provisioned binary sidecar has to have. `lib/daemons/contract.mjs` already names that shape for one process family — persistent background daemons (embed, oracle) with a heartbeat, a single-writer lock, and a bounded lifetime — but a sidecar is a different animal: it is not spawned at `construct init` or as a standing background service, it lives exactly as long as the Node process that spawned it, and it does not need a heartbeat file because its liveness is entirely a function of one parent-child relationship. Applying the daemon contract's rails to it would be the wrong shape; having no contract at all left the actual shape implicit in one file's comments, unverifiable by any other sidecar construct adds later (whisper is the next obvious candidate, per ADR-0059's `optional binary-sidecar` disposition).

## Decision

Every construct-provisioned binary sidecar — a long-lived child process wrapping a heavy optional dependency (docling today; whisper is disposition-eligible per ADR-0059 but not yet implemented as a persistent sidecar) — satisfies five requirements. `lib/document-extract/docling-sidecar.py` + `lib/document-extract/docling-client.mjs` are the reference implementation this ADR names retroactively; a new sidecar is expected to match this shape rather than invent its own.

1. **One JSON-RPC surface.** Newline-delimited JSON over stdin/stdout: `{"id", "method", "params"}` requests, `{"id", "result"}` or `{"id", "error": {"code", "message"}}` responses. No other transport (no HTTP port, no Unix socket) — stdio is already process-scoped and needs no separate cleanup path.

2. **Lazy provisioning, never at `construct init`.** The heavy dependency (a uv venv, a downloaded model) is provisioned on the first real extraction call, not when a project is initialized. `construct install --with-docling` is the only eager opt-in, and it is a machine-scope install action, not part of `construct init`'s project-scope flow. `lib/init-unified.mjs` names zero docling/whisper provisioning calls; the provisioning entrypoint (`ensureDoclingVenv`) is reachable only from `lib/document-extract/docling-client.mjs`'s first `extractViaDocling` call and from `lib/setup.mjs`'s explicit `--with-docling` flag.

3. **Machine-shared runtime location, version-pinned via a lockfile-equivalent marker.** The provisioned artifact lives at a machine-shared path resolved by `resolveSharedRuntimeDir` (`lib/state-root.mjs`) — never per-project, never inside a git-tracked directory. A version pin (`DOCLING_PIN` compared against `.install-marker.json`'s recorded version) is checked on every resolution; a mismatch clears the stale install and re-provisions under the same code path a fresh install takes, rather than layering a new version over an old one or silently continuing to use a stale build.

4. **Parent-PID watch.** The sidecar is spawned as a direct child of the Node process (`child_process.spawn`, not detached), so its OS-reported parent PID at startup is exactly that Node process. A background thread inside the sidecar polls its own `getppid()` on an interval; a change (POSIX reparents an orphan away from its original parent) means the parent died without running its own cleanup, and the sidecar exits itself rather than becoming an orphaned resident process. This is a second, independent line of defense — the parent side already tries to kill the child on `process.on('exit')` and on an explicit `shutdown` RPC, but neither of those run if the parent is killed with a signal that skips exit handlers (`SIGKILL`). The watch is best-effort on Windows, where orphan reparenting does not behave the same way; it is a guarantee only on POSIX.

5. **No business logic in the sidecar.** The sidecar's only job is to wrap the underlying library's extraction call and shape the result (`markdown`/`metadata`/`droppedInfo`) into the RPC response — it does not decide fallback strategy, does not know about the degradation chain, and does not touch construct's own config or state root beyond the one runtime directory it was told to use. Routing (which extractor handles which format), fallback selection, and the degradation chain (ADR-0059's `optional`/`graceful-skip`) are entirely Node-side decisions (`lib/document-ingest.mjs`, `lib/document-extract.mjs`).

Doctor integration: `construct doctor` reports the sidecar's install state via `describeDoclingRuntime()` (`lib/runtime/uv-bootstrap.mjs`), surfaced as an optional (non-fatal) finding — present-and-pinned is healthy, absent is degraded per ADR-0059's `graceful-skip` taxonomy, never a hard failure, since the node-native fallback tier (`unpdf`/`mammoth`) keeps ingestion functional without it.

## Rationale

Treating the sidecar's lifetime as exactly the parent Node process's lifetime — rather than as an independent background service — is what makes the parent-PID watch the correct safeguard instead of a heartbeat/lock file: there is only ever one parent, known at spawn time, and the only failure mode worth guarding is that specific parent dying uncleanly. `lib/daemons/contract.mjs`'s heartbeat and single-writer lock exist to answer "is any instance of this daemon already running, and is it still alive," a question that only makes sense for a process nothing else directly owns; a sidecar is always owned by exactly the process that spawned it, so that question does not apply. Machine-sharing the provisioned artifact (requirement 3) is what makes "one JSON-RPC surface" cheap to keep warm across a session instead of re-paying uv/venv startup — and per ADR-0066, sharing it is the whole point of moving it out of per-project state in the first place. Keeping business logic entirely on the Node side (requirement 5) is what lets the sidecar be replaced (a different docling version, eventually a different extractor) without touching the routing/fallback code that governs it.

## Rejected alternatives

- **Route the sidecar through `lib/daemons/contract.mjs`'s `createDaemon`.** Rejected: that contract's safeguards (bounded 24h lifetime, idle-tick shutdown, single-writer lock) all assume an independently-running background process nothing else directly parents — none of that maps onto a process whose entire lifetime is already bounded by its one parent's lifetime, and forcing the fit would add a heartbeat file and lock file the sidecar has no use for.
- **Have the parent explicitly pass its own PID to the child via argv/env instead of relying on `getppid()`.** Rejected: unnecessary — `child_process.spawn` (not detached, no intermediate shell) makes the Node process the sidecar's literal OS parent, so `os.getppid()` already resolves the right PID with no handoff needed; passing it explicitly would only add a value that could drift from the real parent if the spawn shape ever changed.
- **Use a heartbeat file the parent writes and the sidecar polls, instead of a ppid check.** Rejected: a heartbeat file requires the parent to remember to write it and requires disk I/O on both sides for a liveness signal the OS already tracks for free via the process table; `getppid()` costs nothing extra and cannot go stale the way a file can.
- **Detach the sidecar (`spawn(..., { detached: true })`) so it survives a parent restart and can be reused across Node sessions.** Rejected: a detached sidecar reintroduces exactly the failure mode requirement 4 exists to prevent (an orphaned resident process outliving anything that knows about it) and gains nothing, since the venv/model warm-up it would save is already avoided by machine-sharing the provisioned artifact (requirement 3) — only the per-session process spawn (~tens of ms) is repeated, not the multi-second venv activation.

## Consequences

`lib/document-extract/docling-sidecar.py` and `lib/document-extract/docling-client.mjs` are the reference implementation; both are updated to match this ADR (parent-PID watch added to the sidecar, machine-shared venv resolution in the client's provisioning path). A future whisper sidecar (if whisper moves from a plain CLI invocation to a persistent process for the same warm-model benefit) is expected to satisfy the same five requirements rather than defining its own. `lib/ingest/sidecar-providers.mjs` and `lib/extensions/manifests/docling.manifest.json` predate this ADR and still resolve a project-relative `defaultRuntimeDir` for their (currently unwired into `construct doctor`) install probe — that inconsistency is a known, separate gap this ADR does not resolve, since that code path has no runtime caller today.

A per-request timeout is now a third trigger for killing the sidecar, alongside the parent-PID watch (requirement 4) and the explicit `shutdown` RPC: a request that has not answered within `docling-client.mjs`'s bound gets the process killed (SIGTERM, escalating to SIGKILL) rather than left to keep converting unattended. This was verified against the pinned docling release rather than assumed — `DocumentConverter.convert()` takes no cancellation/deadline argument, and the sidecar's stdin loop reads one request at a time, so it cannot service an incoming cancel message while blocked inside a conversion. Killing the process for one caller's timeout therefore rejects every other request still pending on that same sidecar instance (one JSON-RPC surface, requirement 1, serves one conversion at a time); `getSidecar()` on the Node side respawns a fresh instance for the next call, so the cost is a lost in-flight batch, not a stuck or orphaned process. Bounding how many requests can queue behind one slow sidecar is a separate, not-yet-addressed gap.

## Reversibility

Two-way door: the contract describes an existing process's shape rather than introducing new infrastructure, so revising a requirement (e.g., relaxing the parent-PID watch if a future sidecar needs to outlive its spawning process for a documented reason) only requires updating this ADR and the one reference implementation, not migrating a fleet of already-diverged sidecars.

## References

- `lib/document-extract/docling-sidecar.py`, `lib/document-extract/docling-client.mjs` (reference implementation)
- `lib/runtime/uv-bootstrap.mjs`, `lib/state-root.mjs` (`resolveSharedRuntimeDir`, construct-rf26.16)
- ADR-0036 (docling sidecar evaluation), ADR-0059 (dependency-intent rubric, `graceful-skip` taxonomy), ADR-0066 (config-layer footprint, machine-shared venv)
- `lib/daemons/contract.mjs` (the persistent-daemon contract this ADR deliberately does not reuse)
