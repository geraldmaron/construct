---
intake: none
---

Obsolete: retained as historical workspace-control-plane research; Construct 2.0 uses Worker Profiles, Workspace Presets, and `.construct/` — see docs/obsolete/legacy-surface-register.md.

# Spike F — Runtime Replacement Validation

Authored 2026-07-17, bead `construct-b0nny.5.6`, Wave 3 (`construct-b0nny.5`) of epic
`construct-b0nny`. Validates directive §11 F: "upgrade or replace one runtime adapter; measure
files changed, contracts affected, graph/test/doc changes, migration, user-facing breakage,
rollback, ability of existing runs to finish safely."

**Disposable spike.** All code changes described here were made and tested in a throwaway git
worktree (`/private/tmp/.../scratchpad/spike-f-github-runtime`, branch
`spike/b0nny.5.6-github-runtime-replace`, forked from this branch at `712fbcd6`), never merged
into this worktree's `feat/workspace-control-plane` branch. That worktree and branch were removed
at the end of the spike; `git worktree list` in this worktree shows only the expected entries
throughout. Evidence artifacts (fixtures, harness scripts, run logs, the full diff) are committed
under `docs/notes/research/workspace-control-plane/spikes/f-runtime-replacement/` in this worktree.

## Adapter picked, and why

**`lib/providers/contract/adapters/github/index.mjs`** — the GitHub provider's transport layer,
which shells out to the `gh` CLI via `spawnSync` for every read/write/search call.

Selection rationale, cross-checked against
[disposition-matrix.md](disposition-matrix.md) D1s ("Providers + contract adapters —
retain... exactly the 'behind an adapter' shape the directive wants"):

- **Small, bounded surface.** 201 lines (`index.mjs`) + 171 lines (`governed-write.mjs`), no
  transport-specific dependencies beyond `node:child_process`. Of the four provider adapters
  (github/jira/confluence/slack), github is the only one with no separate `transport.mjs` file —
  the whole transport is one file.
- **Not central / not high-blast-radius.** Zero references from `specialists/org/contracts/`
  (grepped, zero hits). Zero references from `lib/task-graph/`. The only production consumer is
  `lib/providers/contract/adapter-factories.mjs`, which resolves it through one factory function
  behind a dependency-injection seam (`createGovernedGithubProvider({ ghAdapter: githubAdapter })`)
  — the wrapper already treats the transport as swappable.
- **A real "runtime" in the literal sense.** The transport is an external OS-process runtime (the
  `gh` binary) callers must have installed and authenticated. Replacing it with a different
  runtime (an in-process HTTP client) is a genuine runtime-replacement exercise, not a refactor.
- **Already has a governed-write contract wrapper with injected dependencies** (`governed-write.mjs`
  takes `ghAdapter` as a constructor parameter), which is exactly the shape a low-risk swap needs.

## The change

Replaced the `gh` CLI subprocess transport with a GitHub REST API v3 transport over Node's
built-in `fetch`, preserving the provider contract (`interface.mjs`'s `validate()`/
`hasCapability()` shape: `name`, `capabilities`, `init`, `read`, `write`, `search`, `webhook`) and
every caller-visible request/response shape (same read refs, same write item types, same search
scopes, same webhook normalization, same typed errors from `errors.mjs`).

Full diff: [diff.patch](../spikes/f-runtime-replacement/diff.patch). New/old transport source is
archived verbatim at
[fixtures/index.old-gh-cli.mjs](../spikes/f-runtime-replacement/fixtures/index.old-gh-cli.mjs) and
[fixtures/index.new-rest-api.mjs](../spikes/f-runtime-replacement/fixtures/index.new-rest-api.mjs).

### Files changed: 6 exactly

| File | Nature of change |
|---|---|
| `lib/providers/contract/adapters/github/index.mjs` | Full transport rewrite: `spawnSync('gh', ...)` → `fetch()` against `https://api.github.com` (configurable `apiBase` for GHE/testing). Token auth (`GITHUB_TOKEN`/`GH_TOKEN`/`config.token`) replaces `gh auth status`. Repo scoping now explicit (`config.repo`/`GITHUB_REPOSITORY`/best-effort git-remote inference) instead of `gh`'s cwd-based inference. |
| `lib/providers/contract/adapters/github/governed-write.mjs` | Comment-only: 3 lines describing the wrapped transport as "CLI-backed"/"gh CLI transport" corrected to be transport-agnostic. No logic change — the retry-after backoff loop reads `err.retryAfter` exactly as before. |
| `lib/providers/contract/adapter-factories.mjs` | Comment-only: 1 line corrected ("github's transport is the gh CLI" → describes the REST transport's credential timing). Wiring (`github: () => createGovernedGithubProvider({ ghAdapter: githubAdapter })`) unchanged. |
| `docs/guides/concepts/architecture.mdx` | 1 table cell: `| Code host (GitHub) | gh CLI | ... |` → `| ... | REST API v3 | ... |`. |
| `tests/provider-github.test.mjs` | Comment-only: stale claim about a `GITHUB_TOKEN`-gated skip that doesn't exist in the file's actual logic, corrected to describe what the file actually does (pure/local checks, no network, no token). Pre-existing inaccuracy, unrelated to this swap, fixed incidentally while touching the file. |
| `tests/writes/github.functional.test.mjs` | Comment-only: 2 "gh"/CLI-specific descriptions of the fake adapter generalized to "transport adapter." |

`git diff --stat` (pre-existing-comment-only files included): **6 files changed, 161
insertions(+), 116 deletions(-)**. The only file with functional (non-comment) changes is
`index.mjs` itself.

## Contracts affected

- **`lib/providers/contract/interface.mjs`** (the `validate()`/`hasCapability()` contract every
  provider must satisfy) — **unaffected**. The new transport satisfies it identically; the
  existing `contract-tests.mjs` suite (imported unmodified by `tests/provider-github.test.mjs`)
  passes with zero changes.
- **`lib/providers/contract/adapter-factories.mjs`'s `DEFAULT_ADAPTER_FACTORIES`** — **unaffected**
  structurally (same key, same factory shape); only a stale comment corrected.
- **`lib/providers/contract/adapters/github/manifest.json`** (the governed-write manifest:
  `transportModule`, `secretEnvKeys: ["GITHUB_TOKEN", "GH_TOKEN"]`, `operations`) — **zero changes
  needed**. `secretEnvKeys` already named the REST-style env vars, even though the CLI transport
  never read them (it relied on `gh`'s own separately stored OAuth session) — the swap is what
  makes this manifest field accurate for the first time, a real pre-existing-inconsistency finding
  surfaced incidentally.
- **`lib/extensions/manifests/github.manifest.json`** (the read-oriented registry entry the graph
  builder consumes) — **zero changes needed**; see Graph below.
- **`specialists/org/contracts/`** — grepped, **zero references** to `github` in that directory;
  no handoff-contract postcondition touches this adapter.

## Graph / test / doc changes needed

**Graph.** `construct graph`'s `provider` nodes are built by
`lib/graph/build-from-registry.mjs` (lines ~183–208) exclusively from
`lib/extensions/manifests/*.manifest.json` fields: `id`, `kind`, `version`, `owner`,
`capabilities`, `operations`. None of those fields changed on `github.manifest.json` — the node's
`capabilities: ["read","search","webhook","write"]` and `operations` are identical before and
after. **`construct graph` needs no rebuild or schema change for this swap** (verified by reading
the builder and confirming the manifest file is untouched — not by running a full graph rebuild,
which the disposition matrix scopes to `construct-b0nny.2`).

**Tests.** Of 19 tests directly exercising this adapter (`tests/provider-github.test.mjs`,
`tests/writes/github.functional.test.mjs`), **1 broke**:

> `tests/provider-github.test.mjs` — "throws on unknown write type without live gh" — expected
> `/Unknown GitHub write item type/`, got `Error: github provider: no repo configured (...)`.

Root cause: the old transport computed an optional `repoFlag` and only required a real repo when
it actually shelled to `gh`; validating `item.type` happened unconditionally regardless of repo
state. My first draft of the REST transport called `this._requireRepo()` unconditionally at the
top of `write()`, before checking `item.type` — so an unrelated "is this a known write type" test
(which never calls `init()`, so `_repo` is `null`) hit the repo guard first instead of the
type-validation error the test expects. **Fix: a 3-line reorder** — validate `item.type` against
the known set before resolving the repo, mirroring the original ordering. After the fix: **19/19**
targeted tests pass (baseline: 19/19 before any change), plus a 4th file
(`tests/writes/import-guard.test.mjs`, which statically asserts every caller resolves adapters
through the shared factory) — **23/23** total. The full unit suite excluding functional tests:
**524/524 pass**, both immediately after the swap and again after rollback (logs:
[full-unit-suite-after-swap.log](../spikes/f-runtime-replacement/logs/full-unit-suite-after-swap.log)).
Zero files under `tests/functional/` reference this adapter (grepped for `*github*`,
`*provider*write*` — no matches), so no functional test needed fixing.

**Docs.** One doc needed a real update: `docs/guides/concepts/architecture.mdx`'s "Shipped
providers" table row (`Code host (GitHub) | gh CLI | ...`). Grepping `docs/` for
`gh CLI`/`gh auth status`/`spawnSync.*gh` beyond that turned up only unrelated hits (GitHub Copilot
device-flow auth, `gh --version` host-capability probing, `model-router` provider detection) —
none reference this adapter's transport.

**Independently confirmed clean via the repo's own gates**, run inside the throwaway worktree
(with `node_modules` symlinked from this worktree, since `git worktree add` doesn't copy it):
`construct lint:comments` (comment-policy check) and `construct docs:verify` (documentation
consistency check) both passed on the final diff, and `eslint` reported zero issues on the three
changed `.mjs` files.

## Migration steps required

- **No data migration.** The adapter is stateless (`_repo`/`_token`/`_apiBase` are per-instance
  in-memory fields set by `init()`); nothing persists to disk or a database.
- **Credential migration (real, operational).** The `gh` CLI transport relied on an operator having
  already run `gh auth login` (a persistent OAuth session `gh` manages itself); the REST transport
  requires an explicit `GITHUB_TOKEN` or `GH_TOKEN` environment variable (a long-lived PAT or
  App token) at `init()` time. This is a genuine one-time setup change for any environment running
  this adapter, not a code change.
- **Repo-scoping migration (real, partially unmitigated — see breakage below).** `gh` inferred the
  target repo from the working directory's git context, `GH_REPO`, `gh` config, or the upstream
  tracking branch. The REST transport has no cwd-implicit context; it needs `config.repo` or
  `GITHUB_REPOSITORY` explicitly, or falls back to a narrower re-derivation from `git remote
  get-url origin` (implemented in `inferRepoFromGit()`). Any caller relying on `gh`'s richer
  inference paths (a non-`origin` remote name, `GH_REPO`, or `gh config`) is not covered by this
  fallback and must be updated to pass `config.repo`.
- **No package/dependency migration.** The REST transport adds zero new dependencies (uses Node's
  built-in `fetch`); it *removes* the implicit runtime dependency on the `gh` binary being
  installed and authenticated on the host.

## User-facing breakage

- **Confirmed regression, fixed in-spike:** the write-type validation reordering above — a
  caller who calls `write({ type: 'bogus' })` before ever calling `init()` would have received a
  different, less specific error message under my first draft (a real behavioral difference this
  spike caught and corrected before it could ship).
- **Confirmed, not fully mitigated:** repo-inference narrowing (above) — an operator whose
  workflow depended on `gh`'s `GH_REPO`/`gh config`/upstream-tracking-branch inference sees a new
  `Error: github provider: no repo configured (...)` where the CLI transport silently worked. This
  is real, spike-surfaced user-facing breakage a production migration would need to either close
  (replicate more of `gh`'s inference) or document as a required `config.repo` migration step.
- **No breakage in the request/response contract itself:** read refs, write item shapes, search
  scopes, and webhook normalization are byte-identical in shape to the old transport, confirmed by
  the unmodified existing test suite (19/19) passing against the new transport, plus 6 additional
  end-to-end checks against a real (loopback) HTTP server exercising `init`/`read`/`write`
  (including a real secondary-rate-limit retry)/`search`/404-mapping — see
  [harness/correctness-check.mjs](../spikes/f-runtime-replacement/harness/correctness-check.mjs),
  logged at
  [logs/correctness-check.out](../spikes/f-runtime-replacement/logs/correctness-check.out).
- **Incidental improvement, not breakage:** the REST transport's rate-limit handling reads a real
  `Retry-After` HTTP header instead of regex-scraping `gh`'s stderr text for a "retry...N second"
  substring — strictly more reliable, and the harness's rate-limit check exercises this exact path
  (`retryAfter === 1` parsed from a real response header).

## Rollback proof

Committed the swap as a single commit (`2aaff458`) in the throwaway branch, then ran `git revert
--no-edit HEAD` (`184442c0`). Result: **6 files changed, 116 insertions(+), 161 deletions(-)** —
the exact inverse of the forward diff. Verified byte-for-byte restoration
(`docs/guides/concepts/architecture.mdx` line 204 back to `gh CLI`; `index.mjs`'s header back to
`Transport: gh CLI (must be installed and authenticated).`). Re-ran the test suite post-revert:
**19/19** targeted tests and **524/524** full unit tests pass again, matching the pre-change
baseline exactly. A single `git revert` is sufficient — no feature flag, no data reconciliation,
because nothing durable was written by this adapter in the first place (see Migration above).

## Ability of existing in-flight runs to finish safely

Directive §11 F asks this explicitly, and it is testable for this specific runtime: Node's ESM
loader caches an imported module by resolved file URL at first `import()`, and never re-reads
the file from disk on a later `import()` of the same specifier — a process only sees a new module
body by importing a specifier it has not already resolved (or by restarting).

[harness/in-flight-safety-check.mjs](../spikes/f-runtime-replacement/harness/in-flight-safety-check.mjs)
proves this concretely:

1. `work/index.mjs` starts as the OLD (`gh`-CLI) generation.
2. Child process A imports it (loads OLD), then sleeps 1.5s to model an in-flight call.
3. 400ms into that sleep — the on-disk file is overwritten with the NEW (REST) generation, the
   runtime swap landing mid-flight.
4. Child A wakes and imports the same specifier a second time.
5. Child process B starts fresh, after the swap, and imports for the first time.

Result (log: [in-flight-safety-check.out](../spikes/f-runtime-replacement/logs/in-flight-safety-check.out)):
child A reports `old-gh-cli` both before and after the swap, with `sameModuleObject: true` (the
exact same in-memory module instance) — an in-flight process is **unaffected** by a concurrent
on-disk swap and completes with the code it started with. Child B, started after the swap, reports
`new-rest-api` immediately.

**Concrete implication for this codebase's daemons** (disposition-matrix B1, the embed daemon,
which loads provider adapters and stays resident): a runtime-replacement deploy that only swaps
files on disk is *safe* for whatever the daemon is mid-executing — no in-flight write can be
corrupted or torn mid-call — but the swap is also *not live* for that daemon process until it
restarts. Cutting a provider adapter over in a resident process requires a coordinated
drain-then-restart, not just a file replace; this matches the disposition matrix's own M3/M5
rollback pattern of a "config-declared adapter/runtime selection" rather than assuming a hot file
swap takes effect immediately.

## Go/no-go verdict

**Go, cheaply — for adapters shaped like this one.** Total cost to replace this runtime: one
~245-line file rewritten, 4 files with stale-comment-only touch-ups, 1 documentation table cell,
and one 3-line test-breaking fix caught by the existing suite. Zero graph schema changes, zero
`specialists/org/contracts/` changes, zero data migration, and a one-command rollback. This
validates disposition-matrix D1s's "retain the adapter framework... exactly the 'behind an
adapter' shape the directive wants" verdict: the dependency-injected governed-write wrapper
(`ghAdapter` as a constructor parameter) is precisely what made this swap mechanically cheap and
cleanly reversible.

**The real cost of a runtime replacement in this architecture is not the code swap — it's the two
things a contract test suite doesn't catch:** (1) implicit, unwritten behaviors the old runtime
provided for free (here: `gh`'s cwd/env-based repo inference) that a new runtime cannot replicate
without deliberate extra work, and (2) the credential/config *acquisition* model, which is an
operational migration for users, not a code migration, and isn't exercised by any automated test.
Both surfaced only because this spike built a real, working replacement and pushed on it with a
live-shaped harness (a mock HTTP server, a 404/401/403/429 error-mapping check, and a two-process
module-cache experiment) — a written plan would not have surfaced the write-type validation-order
regression or the repo-inference gap.

**Generalization to the larger replace verdicts.** Disposition-matrix D2s (model-router /
provider-invocation loop, "replace... Highest-risk seam") is a materially larger, differently
shaped problem — ≥16 importers rather than 1, and no existing dependency-injection seam analogous
to `ghAdapter` — so this spike's low cost should not be read as evidence that D2s is similarly
cheap. What generalizes is the *methodology*: budget explicit spike time for (a) a live-shaped
correctness harness beyond the existing unit tests, and (b) an audit of implicit/undocumented
behaviors the current runtime provides, before estimating a runtime-replacement's cost from the
code diff alone.
