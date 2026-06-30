---
intake: none
---

# Credential & Secrets Handling — Remediation Plan

Status: draft plan (no code changes). Branch lineage: `audit/full-surface-staging` → `audit/best-practice-alignment`.
Every finding below was verified by reading source on this branch. Comments and test names were treated as
claims to be proven, not as evidence. Citations are `file:line` against the current tree.

---

## 1. Executive summary

Construct has **two independent 1Password invocation mechanisms** and they do not cooperate:

1. **`op read <ref>`** — per-variable lazy resolution in `lib/providers/secret-resolver.mjs:60`, memoized in a
   **module-level `Map` that lives only for one Node process** (`secret-resolver.mjs:34,77-80`).
2. **`op run --no-masking --env-file …`** — built by `wrapWithOpRun` in `lib/providers/op-run.mjs:49-58`, intended
   to resolve a whole env-file once at service startup so children inherit resolved keys.

The headline structural defect: **`wrapWithOpRun` is imported (`lib/service-manager.mjs:16`) but has zero call
sites in the entire repo.** The "resolve once at startup, children inherit" path that `op-run.mjs`'s own docstring
promises (it explicitly names `op run -- opencode`) **does not exist in practice**. OpenCode and every other service
is spawned inheriting raw `process.env` (`service-manager.mjs:375,387,402`), so the only working `op` path is the
per-process, per-variable `op read`.

That is the **root cause of repeated 1Password prompts**: Construct launches many short-lived processes (CLI
subcommands, hooks, workers, provider polls). Each starts with a cold `opCache`, so each re-runs `op read` on first
touch of an `op://`-backed key → a fresh biometric prompt. `lib/models/provider-poll.mjs` makes it worse by
resolving secrets **before** consulting its on-disk catalog cache (`provider-poll.mjs:330,336-344,350-368`), so even a
warm cache does not prevent a resolution. The "auth once" contract (ADR-0042 L78-87) is real but **only proven
in-process** — `tests/functional/auth-once.functional.test.mjs` uses an injected in-memory `opRead` stub and a single
process; nothing proves auth-once across process boundaries, and the design cannot deliver it.

Alongside the prompt problem, source review confirmed a set of secret-exposure defects: `--no-masking` hardcoded as
the only `op run` mode; 6-char secret prefixes printed in env-shadow warnings; 8-char prefixes printed (and a live
`op read` executed) by `construct credentials`; **local/stdio MCP credentials (`linear`/`slack`/`notion`) materialized
as plaintext into four host config files plus `~/.env`**; two divergent precedence ladders; no audit trail for secret
resolution; and plaintext tokens at rest protected only by file mode.

This plan separates **confirmed defects** from **risks**, **design gaps**, and **doc mismatches**, then proposes ten
remediation epics. The structural fix (Epic 1) centralizes resolution behind one shared primitive that delivers
auth-once **per user session** without persisting plaintext to disk. The rest are independently shippable hardening
items, most parallelizable.

---

## 2. Confirmed current-state map of all secret surfaces

### 2.1 The two `op` invocation paths

| Path | Where | Cache | Masking | Prompts? |
|---|---|---|---|---|
| `op read <ref>` (per-var) | `secret-resolver.mjs:60` (`defaultOpRead`) | in-process `Map` (`:34,77-80`), 20s timeout (`:32`) | n/a | Yes, once per ref **per process** |
| `op run --env-file` (bulk) | `op-run.mjs:54` (`wrapWithOpRun`) | none (op resolves whole file) | **`--no-masking` hardcoded** | Would prompt — **but never invoked** |
| `op --version` probe | `op-run.mjs:39` | n/a | n/a | No (local) |
| `op read` in diagnostics | `bin/construct:447` (`credentials` cmd) | none | n/a | Yes, on demand |
| `op item list` (link) | `credential-bootstrap.mjs` (autoLink) | `lastBootstrapResult` module cache (`:116`) | n/a | Yes, when `autoLink:true` |

### 2.2 Resolution precedence (as implemented, not as documented)

`secret-resolver.mjs:rawCandidate` (`:141-154`) — the LLM path resolver — is a **7-step ladder**:
1. `process.env[var]` (`:142`)
2. `<XDG>/config.env` (`:144`)
3. `~/.env` (`:144`)
4. `<cwd>/.env` (project) (`:144`)
5. alternate stores: creds rotation store, then OpenCode provider config — `discoverAlternateRawForVar` (`:149` →
   `credential-sources.mjs:50-63`)
6. op-env catalog pointed to by `CONSTRUCT_OP_ENV_FILE` (`:151`)
7. shell rc files `.zshrc/.bashrc/.bash_profile/.profile` (`:153`, `readShellRcVar`)

`loadConstructEnv` (`env-config.mjs:112-172`) — used to populate `process.env` at startup — is a **different ladder**
that reads only dotenv files and ranks **project `.env` > user `config.env` > shell** (`:119,161`), the inverse of the
resolver's `config.env`-before-project order. Same key in both files resolves to different values depending on the
code path.

### 2.3 Where secrets can be read, materialized, persisted, forwarded, logged, masked

- **Read (no op):** `hasSecret`/`hasAnySecret` (`secret-resolver.mjs:176-187`); `credential-sources.mjs` (creds store +
  OpenCode config); `loadConstructEnv` (raw merge, no resolution).
- **Materialized (op read):** `worker.mjs:258` (per task), `provider-poll.mjs:83/127/158` (per poll per provider,
  pre-cache), `catalog.mjs:90` (catalog refresh), `bin/construct:447` (diagnostics).
- **Persisted plaintext at rest:** `auth-manager.mjs:64` (`auth/<provider>.json`, token + refreshToken, `0o600`);
  `copilot-auth.mjs:119-131` (`auth/github-copilot.json` **and shared `~/.config/github-copilot/apps.json`**, `ghu_`/
  `ghr_`, `0o600`); `creds.mjs:64-67` (`config.env` `CONSTRUCT_CREDS_*_KEY`, `0o600`). No encryption anywhere.
- **Persisted as reference (safe):** `credential-bootstrap.mjs:90-91` writes `op://` ref + chmod `0o600`.
- **Forwarded into host configs:** remote URL MCPs use env-refs (`mcp-platform-config.mjs:49-61`, `codex-config.mjs:90-96`)
  — safe. **Local/stdio MCPs materialize the resolved value** (`mcp-platform-config.mjs:92,123`, `codex-config.mjs:104`)
  into `~/.claude/settings.json`, `~/.config/opencode/opencode.json`, `~/.codex/config.toml`, written via
  `mcp-manager.mjs:423/436/439`, plus a plaintext fan-out to `~/.env` (`mcp-manager.mjs:445-447`).
- **Logged / printed:** env-shadow warnings print 6-char value prefixes (`env-config.mjs:131-132,148-149`);
  `construct credentials` prints 8-char prefixes (`bin/construct:423,448`); `SecretResolutionError` embeds the `op://`
  ref and a 160-char `op` stderr slice (`secret-resolver.mjs:62,67,69,72`).
- **Masked:** never — `op run` always `--no-masking`; no redaction layer exists on any path.
- **Audited:** never — zero structured audit/observation events on the resolve path (`secret-resolver.mjs` has no
  logger/emit/observe call).

### 2.4 Service launch sites (none op-wrapped)

`service-manager.mjs`: memory `cm serve` (`:375`), **OpenCode `opencode serve` (`:387`)**, copilot bridge (`:402`),
doctor daemon (`:214`), oracle daemon (`:226`) — all inherit `process.env`; none call `wrapWithOpRun`. `worker.mjs`
spawns no children (HTTP calls only, keys via in-process `resolveSecret`).

---

## 3. Root-cause analysis — repeated 1Password prompts

**Primary cause (confirmed):** auth-once is scoped to a single Node process because the only working cache is the
module-level `opCache` Map (`secret-resolver.mjs:34`). Construct's execution model is many short-lived processes;
each cold-resolves and re-prompts. The cross-process mitigation that would fix this — `op run` at a stable parent so
children inherit resolved env — is **coded but never wired** (`wrapWithOpRun` has no callers).

**Amplifier 1 (confirmed):** `provider-poll.mjs` resolves the provider secret **before** checking its disk catalog
cache (`:336-344` poll unconditionally; `:330` cache read used only as post-poll fallback at `:350-368`). Opening the
model picker in a fresh process triggers an `op read` per `op://`-backed provider even when a warm catalog exists.

**Amplifier 2 (confirmed):** the double bootstrap in `setup-credentials.mjs:11` then `:13 (force:true)` re-runs the
1Password item-list link in one process; `force:true` bypasses the `lastBootstrapResult` guard
(`credential-bootstrap.mjs:116`) → a redundant `op item list` spawn.

**Possible environmental contributor (unverified, flag for verification):** with the 1Password desktop-app
integration, `op read` should reuse the unlock session across processes within the lock window. If users still see a
prompt on *every* process, the local `op`/desktop integration or session lifetime may not be persisting — verify
`op` account/session configuration before assuming all prompts are Construct-caused. Construct's deterministic levers
are: resolve fewer times (cache-first), resolve at a stable parent (inject), and hold the in-memory cache in one
long-lived process.

---

## 4. Prioritized remediation epics

Severity: **P0** = active secret exposure or the core UX defect; **P1** = correctness/consistency with security impact;
**P2** = hardening, tests, docs.

---

### Epic 1 (P0) — Cross-process auth-once via a centralized credential primitive

**Problem.** Repeated 1Password prompts because resolution is per-process and the bulk-resolve path is dead code.

**Evidence.** `secret-resolver.mjs:34,77-80` (in-process Map); `op-run.mjs:49-58` + zero call sites; `service-manager.mjs:387`
(OpenCode unwrapped); `provider-poll.mjs:336-344` (resolve-before-cache); `auth-once.functional.test.mjs` (in-process only).

**Decision (recorded in ADR-0049, `docs/decisions/adr/0049-cross-process-auth-once.md`): Design A + presence/cache-first.**
The broker (Design B) is the documented fallback only if Design A's residual prompt rate proves unacceptable. Two
designs were weighed:
- **Design A — `op run` at the service-tree root.** Wire `wrapWithOpRun` (or an equivalent) so the top-level
  `construct dev` / long-lived parent is launched under `op run --env-file`, resolving every catalog key once; all
  children inherit resolved env. Pro: minimal new surface, uses 1Password's own model. Con: only helps the
  service-tree, not standalone short-lived CLI invocations/hooks; requires a complete `CONSTRUCT_OP_ENV_FILE` catalog.
- **Design B — in-memory credential broker.** One long-lived local process (new, or fold into an existing daemon)
  resolves each `op://` once, holds plaintext **in memory only**, and serves it to short-lived processes over a unix
  socket (auth via socket file mode + peer-cred check). Short-lived CLIs ask the broker → broker prompts at most once
  per ref per session. Pro: covers every process including hooks/CLI; true session-wide auth-once. Con: more surface;
  must guarantee no disk spill.

**Desired behavior.** A user authenticates 1Password at most once per ref per **session** (not per process). No plaintext
secret is written to disk as a cache. The dead `wrapWithOpRun` import is either wired (Design A) or removed (Design B).

**Files likely affected.** `lib/providers/op-run.mjs`, `lib/service-manager.mjs`, `lib/providers/secret-resolver.mjs`,
`lib/models/provider-poll.mjs`, possibly a new `lib/providers/credential-broker.mjs`, `bin/construct` (dev path),
`docs/decisions/adr/0042-*` (+ a new ADR for the chosen design).

**Implementation steps.**
1. ADR comparing A vs B — **done** (ADR-0049, Design A). Remaining steps below are unblocked.
2. Implement the chosen primitive behind the existing `resolveSecret`/`resolveFirstSecret` API so call sites do not change.
3. Make `provider-poll.mjs` **cache-first**: short-circuit to the valid disk catalog (within `CACHE_TTL_MS`,
   `provider-poll.mjs:24`) **before** any secret resolution; only resolve when the cache is stale/absent.
4. Remove or wire `wrapWithOpRun` per the decision; update `op-run.mjs` docstring to match reality.

**Test plan.** A **real-process** test (spawn the actual binary ≥2 times) asserting `op` is invoked at most once across
processes (inject a counting fake `op` on PATH). A cache-first poll test that asserts zero secret resolution when a
fresh catalog cache exists. Broker tests (if B): socket auth rejects other users; no plaintext file is ever created.

**Regression risks.** Broker availability becomes a dependency; must degrade to direct `op read` if the broker is down.
Design A risks an incomplete catalog silently leaving a key unresolved (must detect + warn). Cache-first poll must not
serve a stale catalog past TTL.

**Acceptance criteria.** Two consecutive fresh CLI invocations that touch the same `op://` key prompt 1Password **once
total**. No plaintext secret cache file exists on disk after the run. Opening the picker with a warm catalog performs
zero `op read`.

**Beads.** `1.1` ADR (A vs B); `1.2` core primitive; `1.3` cache-first provider-poll; `1.4` wire/remove `wrapWithOpRun`
+ docstring; `1.5` real cross-process auth-once test.

**Parallelizable?** `1.3` is independent and can start immediately. `1.2`/`1.4` block on `1.1`. `1.5` blocks on `1.2`.

---

### Epic 2 (P0) — Stop secret fragments in logs and diagnostics

**Problem.** Secret prefixes are printed to stderr/stdout; the diagnostics command resolves a live secret to print it.

**Evidence.** `env-config.mjs:131-132,148-149` (6-char prefix of `OPENROUTER/ANTHROPIC/OPENAI` keys, list at `:89-94`);
`bin/construct:423` (`slice(0,8)`), `:447-448` (runs `op read` then prints `slice(0,8)`); `SecretResolutionError`
embeds ref + stderr (`secret-resolver.mjs:62,67,69,72`).

**Desired behavior.** Shadow warnings report *that* a key is shadowed and *which sources*, never any value bytes.
Diagnostics report presence/source/last-4 only by hashing or fixed mask, never by executing `op read` to print value
bytes. Error messages keep the `op://` ref topology out of any message that could be captured into observations.

**Files.** `lib/env-config.mjs`, `bin/construct` (`credentials` command), `lib/providers/secret-resolver.mjs`.

**Implementation steps.** Replace value-prefix interpolation with source identifiers. Replace the diagnostics
value-prefix + `op read` with a non-resolving presence/source report (use `hasSecret`). Reduce `SecretResolutionError`
to error code + source tier; keep the ref out of the message or gate it behind a debug flag that is never on by default.

**Test plan.** Assert shadow-warning output contains no substring of the value (feed a known sentinel value, assert
absent). Assert `construct credentials` performs no `op read` and prints no value bytes. Snapshot error messages.

**Regression risks.** Diagnostics become less "helpful" for debugging a wrong key — mitigate with last-4 of a salted
hash, never raw bytes.

**Acceptance criteria.** No code path prints any byte of a secret value. `construct credentials` triggers no biometric
prompt.

**Beads.** `2.1` shadow-warning redaction; `2.2` diagnostics no-resolve/no-print; `2.3` error-message scrub; `2.4` tests.

**Parallelizable?** Fully independent of Epic 1. `2.1/2.2/2.3` are separate files/sections — parallel.

---

### Epic 3 (P1) — Masking on by default

**Problem.** `op run` is always `--no-masking`; masking is the only behavior and it is off.

**Evidence.** `op-run.mjs:54` (`'--no-masking'` hardcoded). Constraint from the task: never `--no-masking` as default.

**Desired behavior.** `op run` runs **with** masking by default. If a concrete need to disable masking exists (e.g.,
a child that legitimately needs unmasked output), it must be an explicit, documented, opt-in flag — never the default.

**Files.** `lib/providers/op-run.mjs`, `tests/functional/op-run-wrap.functional.test.mjs`, `docs/guides/reference/config.md`
(L214 documents the operator `op run --no-masking` pattern — reconcile).

**Implementation steps.** Drop `--no-masking` from the default arg vector. Add an explicit opt-in only if a real need
is identified during Epic 1; otherwise omit entirely. Update the test that currently asserts the `--no-masking` vector
(`op-run-wrap.functional.test.mjs:49`). Update config.md guidance.

**Test plan.** Assert the wrapped arg vector does **not** contain `--no-masking` by default.

**Regression risks.** A wrapped child that parsed its own env from unmasked op output would break — none found, but
verify during Epic 1 wiring.

**Acceptance criteria.** Default `op run` invocation is masked.

**Beads.** `3.1` remove default flag + update test/docs. **Note:** must merge *after or with* Epic 1's `1.4` since both
touch `op-run.mjs` — sequence to avoid conflict.

**Parallelizable?** Same-file conflict with Epic 1 `1.4`; assign to the **same owner** as `1.4`.

---

### Epic 4 (P0) — Local MCP credentials by reference, not value

**Problem.** Local/stdio MCP secrets are materialized as plaintext into four host config files and `~/.env`.

**Evidence.** `mcp-platform-config.mjs:55-57,92,123` (`buildLocalEnvironment` substitutes real `resolvedValues`);
`codex-config.mjs:73-80,101-107` (`resolveEnv`); written via `mcp-manager.mjs:423/436/439`; plaintext `~/.env`
fan-out at `mcp-manager.mjs:445-447` (not chmod'd, unlike `credential-bootstrap.mjs:91`); `stripUnresolvedValues`
(`mcp-platform-config.mjs:31-35`) only drops `__`-bearing values so `op://` refs are written verbatim. Affected catalog
MCPs: `linear`, `slack`, `notion` (`lib/mcp-catalog.json`); `github` is `type:url` and already safe.

**Desired behavior.** Local/stdio MCP env uses **env-var passthrough / references**, matching the remote-URL path, so a
resolved value never lands in a host config or `~/.env`. The host resolves the env var at MCP launch (late binding).
For hosts that cannot reference env (verify per host), the value must be injected at process launch, never written to
config.

**Files.** `lib/mcp-platform-config.mjs`, `lib/codex-config.mjs`, `lib/mcp-manager.mjs`, `tests/mcp-secret-ref.test.mjs`.

**Implementation steps.** Change `buildLocalEnvironment`/`resolveEnv` to emit the host's env-ref form for secret keys
instead of substituting values. Stop the plaintext `~/.env` fan-out (or, if env-injection requires it, write a
reference + chmod `0o600` and document it). Make `stripUnresolvedValues` also reject/route `op://` values. Confirm
each host (Claude, VS Code, OpenCode, Codex) actually resolves env refs for local MCPs; where not, inject at launch.

**Test plan.** Extend `mcp-secret-ref.test.mjs` to cover **local/stdio** MCPs (`linear`/`slack`/`notion`) and **Codex**,
and to exercise the **real write site** (`cmdMcpAdd` → file writes) asserting no value byte appears in any written file.

**Regression risks.** A host that does not expand env refs for stdio MCPs would lose the credential — verify per host
before switching; fall back to launch-time injection.

**Acceptance criteria.** After `construct mcp add linear/slack/notion`, no secret value appears in
`settings.json`, `opencode.json`, `config.toml`, or `~/.env`.

**Beads.** `4.1` local-env ref emission (platform-config + codex); `4.2` stop/secure `~/.env` fan-out; `4.3` `op://`
guard in `stripUnresolvedValues`; `4.4` per-host env-ref verification matrix; `4.5` expanded secret-ref tests.

**Parallelizable?** Independent of Epics 1-3. `4.1`-`4.3` touch overlapping files (`mcp-platform-config.mjs`,
`mcp-manager.mjs`) — **single owner** for the trio; `4.4`/`4.5` can follow.

---

### Epic 5 (P1) — One deterministic, documented precedence

**Problem.** `loadConstructEnv` and `secret-resolver` use conflicting precedence; the documented order omits two tiers.

**Evidence.** `env-config.mjs:119,161` (project `.env` > user `config.env`) vs `secret-resolver.mjs:144` (user
`config.env` first); ADR-0042 L33-38 and `secret-resolver.mjs:4-7` describe a 5-step ladder, code is 7-step
(`:149,:151`).

**Desired behavior.** A single, documented precedence ladder honored by both the env-population path and the resolver.
Same key resolves identically regardless of code path.

**Files.** `lib/env-config.mjs`, `lib/providers/secret-resolver.mjs`, `docs/decisions/adr/0042-*`,
`docs/guides/reference/config.md`.

**Implementation steps.** Decide the canonical order (recommend: process.env → project `.env` → user `config.env` →
`~/.env` → alternate stores → op-catalog → shell rc, with a documented rationale). Refactor both readers to a shared
ordered-source helper. Update ADR-0042 and the resolver header to the true 7-step ladder.

**Test plan.** A table-driven test: for each pair of conflicting sources, assert both `loadConstructEnv` and
`resolveSecret` pick the same value.

**Regression risks.** Changing precedence can change which key a user is currently resolving — call out in CHANGELOG;
verify the chosen order does not demote a source users rely on.

**Acceptance criteria.** No documented-vs-implemented precedence gap; both paths agree on every conflict case.

**Beads.** `5.1` choose + document canonical order; `5.2` shared ordered-source helper + refactor both readers; `5.3`
parity test.

**Parallelizable?** `5.2` touches `secret-resolver.mjs` (conflicts with Epic 1/2) and `env-config.mjs` (conflicts with
Epic 2) — **sequence after** Epics 1-2 or coordinate ownership.

---

### Epic 6 (P2) — Non-secret audit events for resolution

**Problem.** Secret resolution is invisible to the audit/observation layer; no record of which ref, which source, or
outcome.

**Evidence.** `secret-resolver.mjs` has zero logger/emit/observe calls (confirmed by grep); ADR/PRD intent NFR-7
(`prd/0001:74`) wants "never in observations" — satisfied by silence, but that silence is the gap.

**Desired behavior.** Each resolution emits a structured event: ref id (vault/item/field allowed — it is not the
value), source tier that satisfied it, success/failure code, latency, cache-hit boolean — **never the value**.

**Files.** `lib/providers/secret-resolver.mjs`, the observation/audit sink it should write to (identify during Epic 6),
`docs/decisions/adr/0042-*`.

**Implementation steps.** Add an injectable audit callback to the resolver (default no-op so tests stay hermetic). Wire
it to the existing observation store. Guarantee the value is never passed to the callback.

**Test plan.** Assert an event is emitted on resolve with ref + source + outcome and assert the value is absent from
the event payload (sentinel check).

**Regression risks.** Must preserve the "never logged the value" invariant — the test must prove absence.

**Acceptance criteria.** A durable, value-free record answers "which refs resolved, from which source, when, success?"

**Beads.** `6.1` injectable audit hook + sink wiring; `6.2` value-absence test.

**Parallelizable?** Touches `secret-resolver.mjs` — coordinate with Epic 1/5 ownership.

---

### Epic 7 (P2) — Bootstrap dedup and idempotence

**Problem.** `setup-credentials.mjs` runs bootstrap twice; the `force:true` re-run re-spawns `op item list`.

**Evidence.** `setup-credentials.mjs:11,13`; `credential-bootstrap.mjs:116` (`force` bypasses cache).

**Desired behavior.** One bootstrap per process; `force` reserved for a genuine cache-invalidation need, not the
default setup path.

**Files.** `scripts/setup-credentials.mjs`, `lib/runtime-env.mjs`, `lib/providers/credential-bootstrap.mjs`.

**Implementation steps.** Remove the redundant `force:true` second call (line 13) or make the first call sufficient.
Confirm the entrypoint call (`bin/construct:84`, `autoLink:false`) still performs no `op` invocation.

**Test plan.** Assert running `setup-credentials` invokes the link path at most once (counting fake `op`).

**Regression risks.** Low — verify `force` is not needed to pick up a key linked earlier in the same process.

**Acceptance criteria.** `setup-credentials` triggers at most one `op item list`.

**Beads.** `7.1` dedup + test.

**Parallelizable?** Fully independent.

---

### Epic 8 (P1) — At-rest posture and the latent plaintext-write path

**Problem.** Tokens/keys are plaintext on disk (mode-only), and a dormant code path can write resolved plaintext into
`config.env` without chmod.

**Evidence.** `auth-manager.mjs:64`, `copilot-auth.mjs:119-131` (incl. shared `apps.json`), `creds.mjs:64-67`;
`health-check.mjs:317,322` (`ref || raw` then write, no chmod, `writeConfig:true` not currently set by any caller).

**Desired behavior.** Close the latent plaintext-write path (or force-ref-only + chmod `0o600`). Document the at-rest
model honestly (plaintext + `0o600` today; keychain is PRD-0002 Phase-2 future, not current). Ensure every credential
write chmods `0o600`.

**Files.** `lib/health-check.mjs`, `lib/providers/creds.mjs`, `lib/providers/auth-manager.mjs`,
`lib/providers/copilot-auth.mjs`, `docs/specs/prd/0002-*` (mark future-state as future, not current).

**Implementation steps.** Make `resolveCredentials` write **references only**, or remove the `writeConfig` plaintext
branch; add chmod. Audit every credential `writeFileSync` for mode `0o600`. Correct PRD/doc tense so keychain claims
read as planned, not current.

**Test plan.** Assert no caller path can persist a resolved value; assert mode `0o600` on all credential writes.

**Regression risks.** Low (path is dormant). Keychain is explicitly **out of scope** for this plan — do not implement.

**Acceptance criteria.** No reachable path writes resolved plaintext to `config.env`; all credential files `0o600`.

**Beads.** `8.1` close `resolveCredentials` plaintext branch + chmod audit; `8.2` doc tense fix.

**Parallelizable?** `8.1` is independent; `8.2` independent.

---

### Epic 9 (P2) — Tests across real process boundaries

**Problem.** Key guarantees are proven only by in-process mocks.

**Evidence.** `auth-once.functional.test.mjs` (in-process counting stub); `provider-poll.functional.test.mjs` (mocked
`fetch`, plain key, no `op://` path); `mcp-secret-ref.test.mjs` (in-process, URL-only, no Codex/local, no write site).

**Desired behavior.** Cross-process and real-write tests back every "auth once / no value on disk / cache-first" claim.

**Files.** `tests/functional/auth-once.functional.test.mjs`, `tests/functional/provider-poll.functional.test.mjs`,
`tests/mcp-secret-ref.test.mjs`, plus new functional tests under `tests/functional/`.

**Implementation steps.** Add a cross-process auth-once test (fake `op` binary on PATH, spawn the real CLI twice, count
invocations). Add a provider-poll test exercising the `op://` path and the cache-first short-circuit. Extend secret-ref
to local MCPs, Codex, and the real `cmdMcpAdd` write site (Epic 4 owns the extension; this epic owns the harness).

**Test plan.** N/A (this epic *is* the tests).

**Regression risks.** Functional tests that spawn `op` must use a fake on PATH — never the real 1Password.

**Acceptance criteria.** Each P0 claim has a real-boundary test that would fail under today's code.

**Beads.** `9.1` cross-process auth-once harness; `9.2` provider-poll op:// + cache-first; `9.3` secret-ref real-write
(coordinated with `4.5`).

**Parallelizable?** Mostly independent; `9.x` depend on the corresponding epic's behavior landing first.

---

### Epic 10 (P2) — Docs and ADR reconciliation

**Problem.** Docstrings and ADRs describe intended, not actual, behavior.

**Evidence.** `op-run.mjs:6-9` (claims services spawn via `op run` — false); `opencode-config.mjs:51-54` (premise inert);
ADR-0042 precedence understated; PRD-0002 keychain claims read present-tense; `mcp-manager.mjs:456` "no token stored on
disk" broader than reality.

**Desired behavior.** Every load-bearing claim in docs/comments matches the code after Epics 1-9 land.

**Files.** `op-run.mjs` docstring, `opencode-config.mjs` comment, ADR-0042, PRD-0002, `mcp-manager.mjs:456` notice,
`docs/guides/reference/config.md`, `CHANGELOG.md`, `.cx/context.md`.

**Implementation steps.** Update each claim to match post-remediation behavior; scope the "no token stored" notice to
the exact path it covers.

**Test plan.** `lib/comment-lint.mjs` + `construct doctor`; manual claim re-verification against code.

**Regression risks.** None (docs).

**Acceptance criteria.** No remaining doc/comment claim contradicts the code.

**Beads.** `10.1` code-comment/docstring fixes; `10.2` ADR/PRD updates; `10.3` CHANGELOG + context.

**Parallelizable?** Must land **last** (docs describe final behavior), but drafting can proceed in parallel.

---

## 5. Do NOT do (guardrails for executing agents)

- **Do not** write any plaintext secret to disk as a cache to "solve" the prompt problem. The auth-once fix is
  in-memory (broker) or env-injection (op run at root) — never a plaintext file.
- **Do not** add `CONSTRUCT_SKIP_*` / `CONSTRUCT_ALLOW_*` env vars to bypass any gate (repo rule).
- **Do not** keep `--no-masking` as the default; if an opt-out is ever added it must be explicit and off by default.
- **Do not** rely on shell-rc parsing as a primary secret source — it stays a documented last-resort fallback only.
- **Do not** print any byte of a secret value in logs, warnings, diagnostics, or errors — not even a prefix.
- **Do not** claim "auth once" without a **cross-process** test that spawns the real binary ≥2 times with a fake `op`.
- **Do not** accept a comment/test name as proof — re-verify against code (this whole plan was built that way).
- **Do not** materialize a resolved value into any host MCP config; use references/passthrough with late binding.
- **Do not** implement OS-keychain storage in this plan — it is PRD-0002 Phase-2 and out of scope; only fix tense.
- **Do not** edit `lib/hooks/*.mjs` as part of this work without isolated testing first (repo rule).

---

## 6. Final ordered execution plan for parallel agents

**Wave 0 — decision gate (1 agent, blocking):**
- `1.1` ADR: Design A (`op run` at root) vs Design B (in-memory broker). Nothing in Epic 1's core starts until this lands.

**Wave 1 — fully independent, start immediately in parallel (5 agents):**
- Agent α: Epic 2 (log/diagnostics leaks) — `env-config.mjs` warn sections + `bin/construct` credentials cmd.
- Agent β: Epic 4 (local MCP refs) — `mcp-platform-config.mjs` + `codex-config.mjs` + `mcp-manager.mjs` (single owner of this file trio).
- Agent γ: Epic 7 (bootstrap dedup) — `setup-credentials.mjs`.
- Agent δ: Epic 1 `1.3` only (cache-first provider-poll) — `provider-poll.mjs` (independent of the ADR).
- Agent ε: Epic 8 `8.1` (close latent plaintext write) — `health-check.mjs` + creds chmod audit.

**Wave 2 — after Wave 0 ADR (2 agents):**
- Agent ζ: Epic 1 `1.2`/`1.4` (core primitive + wire/remove `wrapWithOpRun`) **and** Epic 3 (`op-run.mjs` masking) —
  same owner because both touch `op-run.mjs`/`service-manager.mjs`.
- Agent η: Epic 5 `5.2` (shared precedence helper) — **after** Agent α/ζ release `secret-resolver.mjs`/`env-config.mjs`.

**Wave 3 — after the behavior they describe/test lands:**
- Epic 6 (audit events) — `secret-resolver.mjs`, after Wave 2 releases the file.
- Epic 9 (cross-process tests) — `9.1` after `1.2`; `9.2` after `1.3`; `9.3` with `4.5`.
- Epic 10 (docs/ADR) — last.

---

## 7. Traffic jams and merge-conflict risks

| File | Epics that touch it | Mitigation |
|---|---|---|
| `lib/providers/secret-resolver.mjs` | 1 (`1.2`), 2 (`2.3`), 5 (`5.2`), 6 (`6.1`) | **Single owner, sequenced**: 1.2 → 2.3 → 5.2 → 6.1. Do not parallelize. |
| `lib/providers/op-run.mjs` | 1 (`1.4`), 3 (`3.1`) | Same owner (Agent ζ) — one PR. |
| `lib/env-config.mjs` | 2 (`2.1`), 5 (`5.2`) | Agent α first (shadow warnings), then Agent η (precedence helper). |
| `lib/mcp-manager.mjs` + `lib/mcp-platform-config.mjs` | 4 (`4.1`/`4.2`/`4.3`) | One owner (Agent β) for the whole trio. |
| `lib/service-manager.mjs` | 1 (`1.4`) | Single owner (Agent ζ). |
| `bin/construct` (7005 lines) | 2 (`2.2`), 7 (verify `:84`) | Distinct sections (`credentials` cmd vs entrypoint) — low risk, but coordinate. |
| `docs/decisions/adr/0042-*` | 1, 5, 6, 10 | Epic 10 consolidates; others leave TODO notes rather than editing in-flight. |

`provider-poll.mjs` (Epic 1.3 only), `setup-credentials.mjs` (Epic 7), `health-check.mjs` (Epic 8) have **single
touchers** — safe to fully parallelize.

---

## 8. Validation commands (run at end)

```bash
# Targeted credential/secret suites (must pass)
node --test tests/functional/auth-once.functional.test.mjs \
            tests/functional/secret-resolver.functional.test.mjs \
            tests/functional/op-run-wrap.functional.test.mjs \
            tests/functional/provider-poll.functional.test.mjs \
            tests/functional/openrouter-key.functional.test.mjs \
            tests/functional/init-no-project-secrets.functional.test.mjs \
            tests/functional/copilot-auth.functional.test.mjs \
            tests/mcp-secret-ref.test.mjs tests/op-log.test.mjs \
            tests/env-config.test.mjs tests/provider-github.test.mjs

# No-skip-var guard + comment lint on touched files
node --test tests/hooks/no-skip-vars.test.mjs
node lib/comment-lint.mjs   # or the project's configured invocation

# System health + platform regen
construct doctor
construct sync && construct list

# Leak grep — no secret-shaped string in generated host configs after an mcp add (use a sentinel key)
#   then: grep -RInE 'sk-[A-Za-z0-9]{20,}|op://[^ ]+/[^ ]+/[^ ]+|SENTINELVALUE' \
#         ~/.claude/settings.json ~/.config/opencode/opencode.json ~/.codex/config.toml ~/.env  -> expect no hits

# Full gate (release pipeline parity)
npm run release:check
```

---

## 9. Pre-change verification checklist for executing agents

Before editing, each agent must re-confirm (do not trust this plan blindly):
- The `file:line` citations in their epic still match the current tree (the branch may have moved).
- For Epic 1: re-grep `wrapWithOpRun` callers — if any appear, the design premise changed.
- For Epic 4: verify per-host whether the host **actually** expands env refs for stdio MCPs before switching off
  value materialization; if a host cannot, use launch-time injection, not a config write.
- For Epic 1.3 / cache-first: confirm `CACHE_TTL_MS` semantics and that no caller depends on resolve-as-side-effect.
- For Epic 8: confirm no caller sets `writeConfig:true` before removing the branch.
- For any `op` test: use a **fake `op` on PATH**, never the real 1Password binary.
