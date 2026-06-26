<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0042: LLM credential resolution — 1Password op:// and Copilot device flow

- **Date**: 2026-06-18
- **Status**: accepted
- **Deciders**: Gerald Dagher (owner), Construct maintainers (cx-architect)
- **Relates to**: ADR-0003 (provider interface), ADR-0041 (owned loop)

## Problem

The LLM credential path did not match how operators actually hold credentials,
so configured providers read as unconfigured and the owned loop could not run.

Two concrete failures, both verified on a live machine:

- **API keys in 1Password.** Operators store provider keys as `op://` references
  (the dev-machine convention is `op://` refs resolved at runtime via `op run`).
  The LLM key reader (`lib/orchestration/worker.mjs` `resolveKey`) returned the
  literal `op://...` string instead of resolving it, and `lib/model-router.mjs`
  reported Anthropic/OpenAI/OpenRouter as not configured. A duplicated `op read`
  resolver already existed for integrations (`lib/integrations/intake-integrations.mjs`,
  `lib/health-check.mjs`, `lib/embed/daemon.mjs`) but was never wired into the
  LLM path.
- **Copilot authenticated against the wrong app.** `lib/bridges/copilot-proxy.mjs`
  minted a Copilot token from `gh auth token`. The GitHub CLI's OAuth app is not
  Copilot-entitled, so `copilot_internal/v2/token` returned 404 and every Copilot
  call failed — even though the operator uses Copilot in their editor.

## Decision

1. **One secret resolver for the LLM path** (`lib/providers/secret-resolver.mjs`).
   Resolves a canonical var through env -> `~/.config/construct/config.env` -> `~/.env`
   -> project `.env` -> shell rc, and resolves `op://` references (bare or
   `$(op read '...')`) through the `op` CLI, cached per reference for the process
   and never logged. `hasSecret` checks presence without invoking the CLI so a
   stored `op://` reference counts as configured with no biometric prompt.
   When `CONSTRUCT_OP_ENV_FILE` points at an `op run` catalog, keys listed there
   count as configured without duplicating refs into config.env.
   `worker.mjs`, the chat engine (`apps/chat/engine/ai-sdk-agent.mjs`), and the
   router's detection (`isProviderConfigured`) all resolve the same way.

2. **GitHub Copilot uses the community-standard OAuth device flow**
   (`lib/providers/copilot-auth.mjs`): the public Copilot app
   (`Iv1.b507a08c87ecfe98`) -> `ghu_` access token + `ghr_` refresh token ->
   exchange at `copilot_internal/v2/token` for a short-lived session token used
   against `api.githubcopilot.com` with the `Editor-Version` and
   `Copilot-Integration-Id` headers. Credentials persist to Construct's auth store
   and the shared `~/.config/github-copilot/apps.json` other tools read; the
   access token refreshes from the refresh token; the session token is cached
   until shortly before expiry. `construct creds login copilot` drives the flow.
   The owned loop and the worker consume this directly; `copilot-proxy.mjs` is
   repointed to the same module so OpenCode keeps working.

## Rejected alternatives

- **`gh auth token` for Copilot.** Confirmed non-functional: the CLI app is not
  Copilot-entitled (404 from the exchange endpoint).
- **A community AI SDK Copilot provider** (e.g. `@github/copilot-sdk`-based).
  Adds a preview dependency and still requires a separate `copilot auth` login the
  operator does not have; the device flow reuses what editors/CLIs already store.
- **Requiring `op run` at launch only.** Works but forces a wrapper for every
  invocation; native resolution makes chat, worker, and router behave the same
  whether or not a wrapper is used.

## Consequences

- API keys may be stored as `op://` references in `~/.config/construct/config.env` and
  resolve everywhere; no secret is written to logs or committed.
- Copilot works without a Copilot-entitled `gh` login; `construct creds login
  copilot` is the entry point and errors point operators to it.
- The Copilot bridge no longer force-maps the model to `gpt-4o`; the requested id
  is passed through and validated against the account's `models` endpoint.
- Detection (bare `construct --list`, `construct creds list`, health) reports
  op:// providers and a stored Copilot credential as configured.

## Auth-once contract (cross-reference)

All LLM and integration paths that resolve `op://` references must route through
`lib/providers/secret-resolver.mjs` so a single reference is materialized once per
process and cached — no repeat `op read` spawn, no repeat biometric prompt. The
contract is enforced by `tests/functional/auth-once.functional.test.mjs` (hermetic,
injected `opRead`). Consumers include `worker.mjs`, the chat engine
(`apps/chat/engine/ai-sdk-agent.mjs`), `isProviderConfigured` in
`lib/model-router.mjs`, and intake integrations (`lib/integrations/intake-integrations.mjs`
via `resolveOpRef`). See CHANGELOG (`construct-m7k2-auth-primitives`) for rollout status.
