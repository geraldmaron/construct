<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0049: Cross-process auth-once — resolve at a stable parent, presence-first everywhere

- **Date**: 2026-06-30
- **Status**: accepted
- **Deciders**: Gerald Dagher (owner), Construct maintainers (cx-architect)
- **Relates to**: ADR-0042 (LLM credential resolution), ADR-0003 (provider interface)
- **Tracking**: construct-trxz (epic), construct-trxz.1

## Problem

ADR-0042 framed an "auth-once contract": an `op://` reference is materialized once
and cached so 1Password prompts at most once. Source review on
`audit/best-practice-alignment` confirmed the cache is a module-level `Map`
(`lib/providers/secret-resolver.mjs:34`) that lives for **one Node process**. The
contract holds per process, not per user session.

Construct's execution model is many short-lived processes — CLI subcommands, hooks,
the worker, provider polls. Each starts with a cold cache and re-runs `op read` on
first touch of an `op://`-backed key, producing a fresh biometric prompt. Two
amplifiers were verified:

- The bulk-resolve path that would fix this — launching a long-lived parent under
  `op run --env-file` so children inherit resolved env — is coded but **never
  wired**. `wrapWithOpRun` (`lib/providers/op-run.mjs:49`) is imported at
  `lib/service-manager.mjs:16` and has zero call sites repo-wide. The
  `op-run.mjs` docstring describing services "spawned through `op run`" is
  aspirational, not actual.
- `lib/models/provider-poll.mjs` resolves the provider secret **before** consulting
  its on-disk catalog cache (`provider-poll.mjs:336-344`; the cache read at `:330`
  is only a post-poll fallback at `:350-368`), so opening the model picker in a
  fresh process resolves every `op://`-backed provider even when a warm catalog
  exists.

`tests/functional/auth-once.functional.test.mjs` proves the in-process cache with an
injected `opRead` stub in a single process; nothing proves auth-once across process
boundaries, and the current design cannot deliver it.

## Decision

Deliver auth-once **per user session** by resolving at a stable parent and never
re-resolving in short-lived children — not by persisting plaintext anywhere.

1. **Resolve at a stable parent (Design A).** Wire the long-lived service tree
   (`construct dev` and the services in `lib/service-manager.mjs`) to launch under
   `op run --env-file` via `wrapWithOpRun`, so `op://` references in the catalog
   resolve once and every child inherits resolved provider keys through its env.
   The dead `wrapWithOpRun` import becomes a live call; the `op-run.mjs` docstring
   is corrected to match.

2. **Presence-first in short-lived paths.** Detection and configuration code paths
   continue to use `hasSecret`/`hasAnySecret` (no `op read`, no prompt). Materializing
   `op read` happens only at the point a plaintext value is actually needed for a
   call, never to merely list or check.

3. **Cache-first metadata refresh.** `provider-poll.mjs` short-circuits to a valid
   on-disk catalog (within `CACHE_TTL_MS`) **before** any secret resolution; it
   resolves only when the cache is stale or absent. Listing models never forces a
   prompt when a fresh catalog is on disk.

4. **Rely on `op`'s own session for the residual.** A standalone short-lived CLI run
   that genuinely needs a plaintext key and is not under the service-tree env still
   resolves through the single resolver; cross-process de-duplication of the prompt
   is delegated to 1Password's native session/agent (desktop-app integration), not
   to a Construct-owned secret store.

## Rejected alternatives

- **In-memory credential broker (Design B).** A long-lived Construct process that
  resolves each `op://` once, holds the plaintext in memory, and serves it to
  short-lived processes over a unix socket. It would deliver true session-wide
  auth-once for every process including hooks and standalone CLI runs. Rejected
  because it makes Construct the custodian of in-memory plaintext secrets behind a
  socket it must authenticate and secure itself — a new and avoidable attack
  surface. Best practice is to lean on the secret manager's own session rather than
  build a bespoke secret server. May be revisited only if Design A leaves an
  unacceptable residual prompt rate that 1Password's native session cannot close.

- **On-disk cache of resolved secrets.** A short-TTL plaintext (or even encrypted)
  file cache of resolved values. Rejected outright: persisting resolved secrets to
  disk contradicts the late-binding principle and the project's no-plaintext stance,
  and a stale or stolen cache is a strictly worse failure mode than a re-prompt.

- **Leaving auth-once as an in-process guarantee.** The status quo. Rejected: it does
  not match the documented contract and produces the repeated-prompt UX that
  motivated this work.

## Consequences

- The service tree authenticates 1Password once at startup (one `op run` env-file
  resolution) instead of each child re-prompting; children receive resolved keys via
  inherited env, no wrapper-per-invocation.
- `op run` runs **with masking** by default (see construct-trxz.3); `--no-masking`
  is removed as the default.
- Provider polling performs zero `op read` when a fresh catalog cache exists.
- The auth-once guarantee gains a **cross-process** test (spawn the real binary ≥2
  times against a fake `op` on PATH, assert one invocation) — the in-process test
  alone is no longer accepted as proof.
- Design A only covers processes under the service-tree env; standalone CLI/hook runs
  still depend on 1Password's native session for cross-process de-duplication. If
  that residual proves unacceptable in practice, Design B is the documented fallback.
- ADR-0042's "auth-once contract" section is superseded by this ADR for the
  cross-process dimension; the single-resolver and presence-check decisions there
  remain in force.

## Update (2026-07-02): single `op run` at the `construct dev` parent (construct-trxz.11)

Design A first shipped as a **per-service** wrap: each of the ~5 long-lived services
(cm, OpenCode, copilot bridge, doctor, oracle) launched under its own
`op run --env-file`, relying on 1Password's session to deduplicate the prompt across
the five launches — a dedup that was never proven and, under a service-account token,
multiplies reads (≈5 services × the catalog's refs per startup).

trxz.11 realizes the ADR's "resolve at a **stable parent**" intent literally:
`construct dev` re-execs itself once under a single `op run --env-file`
(`maybeReExecUnderOpRun`, `lib/providers/op-run.mjs`). Every `op://` reference resolves
one time into that parent process env; the detached daemons it spawns inherit the
resolved keys through the parent env, so the whole tree costs one biometric unlock and
one catalog resolution. A `CONSTRUCT_OP_RUN_ACTIVE` sentinel marks the re-exec'd process
so the per-service `wrapWithOpRun` no longer nests a second `op run` inside it.

The per-service wrap is **retained as the fallback** for daemons started outside the
re-exec'd parent — a doctor or oracle restart from a hook, where no parent resolution
has run — so those still resolve (and are still masked) on their own.

**Masking trade-off (reworks construct-trxz.3).** trxz.3 made `op run` masking the
default so resolved secrets are not echoed to logs. `op run` masks the stdout/stderr of
the process it directly wraps. Under the single parent, `op run` wraps the short-lived
`construct dev` process — so its own stdout is masked — but the daemons are `detached`
children writing to their **own** log files, which the parent's `op run` does not cover.
A daemon that echoes a key therefore logs it unmasked (the logs are local-only, under the
state dir). This masking loss for detached daemon logs is the accepted cost of collapsing
N per-service wraps into one parent resolution; the per-service fallback still masks any
daemon it wraps directly. Revisit only if a daemon is found to emit secrets to its log.
