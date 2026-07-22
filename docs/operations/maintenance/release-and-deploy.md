# Release and deploy automation

> Policy sibling: `docs/operations/maintenance/release-policy.md` describes when to tag. This doc describes what fires when you do.

A consolidated reference for how Construct ships. Every artifact (npm, Docker, binaries, Homebrew, GitHub Pages, AWS smoke) has an automated path; this doc lists them, their triggers, and how to verify each is healthy.

The intent: stop re-deriving the release flow on every cycle. If a step is not automated yet, it is listed here as such, with the bead that tracks it.

## Triggers

| Workflow | File | Trigger | Output |
|---|---|---|---|
| `ci` | `.github/workflows/ci.yml` | push, PR | Tests on Ubuntu × Node 20/22 (PRs) or Ubuntu/macOS × Node 20/22 (main push/schedule/dispatch), comment + prose + profile lints, docs drift, retrieval evals, dependency CVE audit |
| `release` | `.github/workflows/release.yml` | tag `v*` | npm publish (OIDC), CycloneDX SBOM, SEA binaries (linux/darwin/windows × x64/arm64), Homebrew tap bump, GitHub Release |
| `pages` | `.github/workflows/pages.yml` | push to main, manual | GitHub Pages docs site |
| `docs` | `.github/workflows/docs.yml` | push to main affecting docs | Auto-regenerates AUTO doc regions |
| `deploy` | `.github/workflows/deploy.yml` | push to main | Container deploy (if configured) |
| `aws-smoke` | `.github/workflows/aws-smoke.yml` | manual | ECS smoke test (gated, optional) |
| `staging-full-matrix` | `.github/workflows/staging-full-matrix.yml` | daily 09:17 UTC, manual | Full OS×Node matrix + lint suite **on `staging`** — surfaces a red matrix within ~1 day; gates `staging → main` promotion |

## Pre-release channels

Construct uses semver pre-release identifiers to ship preview versions without polluting the stable line. A tag like `v1.0.5-alpha.1` is detected by the release workflow and routed to a separate dist channel; the next stable tag (`v1.0.5`, `v1.1.0`) is what `npm install` keeps installing.

### Channels

| Channel | When to use | npm install command |
|---|---|---|
| `latest` (no suffix) | Stable release. Default for everyone. | `npm install @geraldmaron/construct` |
| `alpha` | Early experiments. Breaking changes likely. Feature not yet complete. | `npm install @geraldmaron/construct@alpha` |
| `beta` | Feature complete. Bugs likely. Looking for testers. | `npm install @geraldmaron/construct@beta` |
| `rc` | Release candidate. Ships as-is unless a blocker surfaces. | `npm install @geraldmaron/construct@rc` |
| `next` | Catch-all for any other pre-release suffix. | `npm install @geraldmaron/construct@next` |

### Tag format

Standard semver pre-release:

```
v1.0.5-alpha.1
v1.0.5-alpha.2
v1.0.5-beta.1
v1.0.5-rc.1
v1.0.5            # stable, when ready
```

The workflow extracts the channel name from the segment after `-` and before the first `.`. Any suffix that does not match a known channel routes to `next`.

### What runs differently for a pre-release

- **npm publish** uses `--tag <channel>` instead of the implicit `latest`, so the dist-tag for `latest` is unchanged.
- **Docker image** gets `:<version>` and `:<channel>` tags. The `:latest` tag is NOT moved.
- **Homebrew tap** bump is skipped. Homebrew tracks stable only.
- **GitHub Release** is marked as pre-release in the API.

All other steps (preflight, gate, binary builds, GHCR push, Trivy scan) run identically.

### Typical pre-release flow

```bash
# Bump to alpha
npm version 1.0.5-alpha.1
git push origin v1.0.5-alpha.1

# Iterate
npm version 1.0.5-alpha.2
git push origin v1.0.5-alpha.2

# Promote to beta when feature complete
npm version 1.0.5-beta.1
git push origin v1.0.5-beta.1

# Release candidate
npm version 1.0.5-rc.1
git push origin v1.0.5-rc.1

# Ship stable
npm version 1.0.5
git push origin v1.0.5
```

`npm version` updates `package.json` and tags in one step. Pushing the tag fires the release workflow.

The `version` npm lifecycle script runs `scripts/sync-construct-version.mjs` after the bump and stages `.construct/launcher/version` into the same commit, so the npx pin that project-local launchers feed to `npx -p @geraldmaron/construct@<version>` never drifts behind the published release. (A stale pin 404s with `ETARGET` and breaks consumer hooks before any Construct code runs.) The preflight re-asserts the pin with `--check`; to repair drift by hand, run `node scripts/sync-construct-version.mjs`.

### Promotion

Pre-release versions become available on their channel immediately. To promote an existing pre-release to stable without republishing, use npm dist-tag from a machine logged in via OIDC or with a publish-scoped token:

```bash
npm dist-tag add @geraldmaron/construct@1.0.5-rc.1 latest
```

Usually you do not promote a pre-release; you ship a clean stable tag instead so the version on `latest` has no `-` suffix.

## Release flow

```
   bump version in package.json
              │
              ▼
    update CHANGELOG.md
              │
              ▼
   npm run release:preflight (local)
              │
              ▼
    git tag vX.Y.Z && git push origin vX.Y.Z
              │
              ▼
    .github/workflows/release.yml fires
              │
   ┌──────────┼──────────────┬──────────┬──────────┐
   ▼          ▼              ▼          ▼          ▼
  npm     binaries (x5)    Docker   Homebrew   GitHub Release
publish   linux/darwin/    GHCR     tap bump   with artifacts
 (OIDC)   windows × x64/
          arm64
```

## Pre-release preflight

Runs locally before tagging so CI is the backstop, not the gate.

```bash
npm run release:preflight              # all checks, requires npm login
npm run release:preflight:no-auth      # skip the auth check
```

Validates: clean git tree, on `main`, `.construct/launcher/version` pin matches `package.json`, CHANGELOG entry for the version, all tests pass, comment policy, docs verify, npm audit, `npm pack --dry-run`, the release evidence gate (below), and (when not `--no-auth`) `npm whoami` against the OIDC environment.

Exit 0 means safe to tag. Anything else: fix locally, do not push the tag and hope.

## Release evidence gate (LMCP-M5)

```bash
node scripts/release-evidence-gate.mjs             # packaging + acceptance tests
node scripts/release-evidence-gate.mjs --skip-tests # packaging only (fast; step 11 of release:preflight)
```

Blocking step, run by both `npm run release:preflight` and `npm run release:check`: for every capability `lib/mode-capabilities.mjs`'s `CAPABILITY_REGISTRY` marks `'implemented'`, verifies the file(s) that implement it actually landed in the packed artifact (`npm pack --json --dry-run`, no tarball written) and that its registered acceptance test (`tests/acceptance/modes/*.acceptance.test.mjs`, `tests/enterprise/audit-isolation.test.mjs`) passes. A release cannot ship claiming a capability the packed artifact does not actually contain or that has stopped passing its acceptance test. Self-test: `node --test tests/scripts/release-evidence-gate.test.mjs`.

### Protocol surface rollup (`construct-tsyfe.9.7`)

```bash
node lib/certification/protocol-surface-rollup.mjs             # human-readable pass/fail
node lib/certification/protocol-surface-rollup.mjs --json      # machine-readable report
```

Release-blocking step in `release:check` and `scripts/pre-release-check.mjs`: after the LMCP-M5 evidence gate, inspects the npm pack dry-run file list against the union of construct-tsyfe.9 sibling certifications — MCP tool-surface partition, CLI public help corpus (no retired aliases), ECL-only exports (no `./lib/*` wildcard), and presence of `lib/acp/server.mjs`, host-adapter modules, and `bin/construct` in the packed artifact. Functional coverage: `node --test tests/functional/protocol-surface-rollup.functional.test.mjs` (clean HEAD pass plus injected wildcard/CLI/pack regressions).

## Release gate (in CI)

`release:check` job in `release.yml` re-runs the preflight equivalent before any artifact step:

- `npm test` (full suite)
- `node bin/construct doctor`
- `node ./bin/construct docs:verify`
- `node ./bin/construct lint:comments`
- `npm run lint:scopes -- --quiet`
- `npm run test:functional`
- `node scripts/release-evidence-gate.mjs --skip-tests` — release evidence gate (above); packaging-only here since `npm test` already ran every capability's acceptance test
- `node lib/certification/protocol-surface-rollup.mjs` — protocol surface rollup (construct-tsyfe.9.7); packed artifact must match MCP/ACP/host/CLI/ECL certifications
- `npm audit --audit-level=high`
- `npm run audit:published` — packs the artifact and audits a clean downstream install with no `overrides` in scope, catching transitive advisories a repo-local override would mask
- `node --test --test-timeout=120000 tests/acceptance/packed-install.test.mjs` — packed consumer install acceptance (LMCP-L2): `npm pack` into a sterile project, smoke `construct version` / `status --json` / `doctor`, and assert removed CLI surfaces (interim list in `tests/acceptance/packed-install-removed-surfaces.mjs`, starting with the removed `construct matrix` alias) do not dispatch from the installed tarball
- `node scripts/supply-chain-release-gate.mjs` — composed supply-chain go/no-go (`construct-tsyfe.10.7`): conjunctive check over OSV/license CI wiring, SBOM release asset, provider-card validation, packed-install wiring, compiled-binary certification evidence, and compat-surface expiration. Philosophy mirrors `construct-4uxq0.14.4` (alive is not sufficient). Wired on the tag path here per `construct-9tg43` gate-scope lesson. Self-test: `node --test tests/scripts/supply-chain-release-gate.test.mjs`

If any of these fail, no artifacts ship. The prose lint is enforced at PR time only (changed-files scope) and is intentionally not in the release gate; running it `--all` on the current historical baseline would always fail until the cleanup PR (`construct-fj0`, `construct-ze6`) lands.

`test:functional` includes `tests/functional/release-gate.functional.test.mjs`, which asserts the refit invariants on HEAD (`construct-d1r7.16`): no implicit active model defaults (every tier resolves to `not configured` on a clean install), optional MCP silence (catalog-only and disabled servers raise no diagnostics), and certified document I/O (the `--certified` matrix must pass when every export engine is installed, degrading to the graceful local matrix on a leaner leg).

### Oracle false-success certification gate (`construct-4uxq0.12.11`)

`node bin/construct certify gate` (step 11 of `npm run release:check`) now includes an Oracle false-success sub-gate:

1. Runs four hermetic certification scenarios against real Oracle invariant and synthesis code: unreachable-SHA close, closed-parent with open children, partial graph rendered as clean, and impact context available but untested capabilities ignored.
2. Each scenario uses fixture-only inputs and asserts Oracle does not return a clean verdict when the false-success condition is present.
3. **Regression:** when any scenario fails (including a deliberate mutation simulating Oracle returning healthy on a known-bad fixture), the release gate blocks and names the regressed scenario id.
4. Scenarios register in `tests/certification/scenarios/catalog.json` under `oracle.false-success.*` with gate type `oracle-false-success-audit`.

See `tests/certification/oracle-false-success.test.mjs`.

### Certified prompt versions (`construct-72gqn.40`)

`node bin/construct certify gate` (step 11 of `npm run release:check`) now includes a prompt-version sub-gate:

1. Computes a sha256 hash over static prompt-composer fragments (`core`, `role-flavor`, `model-profile`) for every registry Worker Profile and operating profile tier (`balanced`, `small`).
2. Persists the last certified hashes in `.construct/certification/prompt-versions.json`.
3. **Bootstrap:** first run with no history writes baseline hashes and passes (does not block the release).
4. **Drift:** when a hash changes, the gate blocks until a passing worker-profile certification run is recorded after the prior certification timestamp (example remediation: `construct certify run worker-profile.happy-path-representative.engineer`).
5. **Unchanged prompts:** unrelated file edits that do not change composed fragments do not trigger re-certification.

See ADR-0095 and `tests/functional/certified-prompt-versions.functional.test.mjs`.

## npm publish (OIDC, no stored token)

Uses GitHub Actions OIDC + npm Trusted Publishers. **No `NPM_TOKEN` secret is set, stored, or needed.** Configuration:

- `actions/setup-node@v6` is configured **without** `registry-url`. With `registry-url` set, setup-node injects `github.token` as `NODE_AUTH_TOKEN`, which the npm registry rejects with 404.
- `npm config set registry https://registry.npmjs.org/` runs as a separate step.
- `npm publish --provenance --access public` exchanges the OIDC token for a short-lived publish token.

One-time setup on npmjs.com: package → Settings → Trusted Publishers → add GitHub Actions with owner/repo and workflow filename. See `docs/operations/maintenance/release-policy.md` for the full one-time setup. If the publish step ever fails with `ENEEDAUTH`, that setup got reverted or the workflow filename moved.

## Docker image (GHCR)

- Tag pattern: `ghcr.io/geraldmaron/construct:vX.Y.Z` + `:latest`.
- Built and pushed from `release.yml` on every tag.
- Trivy scan in the same workflow fails the release on `CRITICAL` or `HIGH` CVEs.

## SBOM (CycloneDX)

- Generated on every tag release in `release.yml` via `npx @cyclonedx/cyclonedx-npm`.
- Output: `dist/sbom.cyclonedx.json`, attached to the GitHub Release alongside binaries.
- npm provenance (`npm publish --provenance`) attests build identity; the SBOM enumerates the dependency graph for vulnerability scanning.

## Compiled binary certification posture

- **Node SEA** (`release.yml`): production release-integrated path; SEA blob build + `postject` seal on every `v*` tag. Evidence artifact: `lib/certification/binary-release-paths.mjs` (`construct-tsyfe.10.5`).
- **Bun compile** (`bun-binary-smoke.yml`): workflow_dispatch and path-triggered smoke only; must never gate `release.yml` per that workflow's header comment. Same evidence artifact documents the asymmetry explicitly (`parityImplied: false`).

## SEA binaries (5 platforms)

- linux x64, linux arm64, darwin x64, darwin arm64, windows x64.
- Built with `node --experimental-sea-config`.
- Uploaded to the GitHub Release for download.
- Homebrew tap formula bump uses these binaries (linux + darwin only).

## Homebrew tap

- `geraldmaron/homebrew-construct` repo holds `Formula/construct.rb`.
- `release.yml` last step bumps the formula's `url`s and `sha256`s for each platform.
- Requires `HOMEBREW_TAP_TOKEN` secret with push access to the tap repo.
- Gated on `vars.HOMEBREW_TAP_ENABLED == 'true'`.
- This is the **Node-SEA** formula (`templates/homebrew/construct.rb`), wired into `release.yml` today. See the Bun-compiled-binary track below for the formula that references Bun binaries instead — the two are not interchangeable until one is chosen as the shipped binary (ADR-0064).

## Bun-compiled binaries (parallel track, construct-rf26.19)

ADR-0064 affirms `bun build --compile` as the primary distribution path going forward, with Node SEA (above) as the recorded fallback if Bun's native-module compatibility ever breaks for LanceDB's N-API bindings or the MCP SDK. This track exists alongside the SEA pipeline and does not gate it — `release.yml` still ships SEA binaries and the Node-SEA Homebrew formula; nothing here runs on a tag push yet.

**Build**: `node scripts/build-binary.mjs [target]` — targets: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`. Requires Bun on PATH (`curl -fsSL https://bun.sh/install | bash`). Compiles from a temporary `.mjs`-suffixed copy of `bin/construct` (Bun's `--compile` bundler only traverses an entry's imports when the entry has a recognized extension) and smoke-tests the result with `construct doctor` when the build host matches the target arch; cross-compiled targets are produced but not executed on a foreign host.

**Two Bun-compile-specific gaps** (construct-qvou, fixed in `lib/roots.mjs`): every bundled module's `import.meta.url`/`process.argv[1]` collapses to the same virtual `/$bunfs/root` path under `--compile`, which broke (a) install-root resolution for every `skills/`/`registry/`/`templates/`/`config/` read, and (b) the `import.meta.url === file://${argv[1]}` "was I run directly" idiom used by ~19 `lib/*.mjs` files that double as standalone scripts (all evaluated true simultaneously). `resolveInstallRoot()` and `isMainModule()` in `lib/roots.mjs` are the fix; both assume the data directories ship next to the binary (true for `dist/<binary>`, one level below the checkout root).

**CI smoke**: `.github/workflows/bun-binary-smoke.yml` — `workflow_dispatch` or on changes to the build scripts / `bin/construct` / `lib/roots.mjs`. Builds one target per matrix leg (`linux-x64` on `ubuntu-latest`, `darwin-arm64` on `macos-15`) and asserts real output, not just exit code: `construct doctor` must print a `Results: N passed, N warnings, N failed` line, and a demo-flow step runs `construct sandbox create/list/delete` end to end, asserting on each command's actual stdout text. Kept separate from `ci.yml`/`release.yml` so a regression here never blocks an unrelated release.

**Curl installer**: `scripts/install.sh` — detects OS/arch, downloads `construct-<os>-<arch>` + its `.sha256` sidecar from a GitHub Release, verifies the checksum, installs to `/usr/local/bin` (or `~/.local/bin`, or `$CONSTRUCT_INSTALL_DIR`). Same URL scheme SEA binaries already publish under (`releases/download/<tag>/construct-<os>-<arch>`), so it works unchanged once Bun binaries are attached to a release. `CONSTRUCT_REPO` and `CONSTRUCT_VERSION` env vars override the repo and pinned version.

**Homebrew formula**: `Formula/construct.rb` — separate from `templates/homebrew/construct.rb` (the live Node-SEA formula); references Bun binary release assets. Not yet pushed to the tap repo or wired into `release.yml`'s Homebrew bump step.

**npm downloader shim**: `bin/construct-shim.mjs` implements the ADR-0064 "npm demoted to downloader shim" design — detect platform/arch, resolve a cached-or-downloaded Bun binary (same URL/checksum scheme as the curl installer, cached under `lib/config/xdg.mjs`'s `cacheDir()` keyed by package version), exec it with argv/exit-code passthrough, and fall back to running the real Node CLI (rather than erroring silently) on an unsupported platform or a failed download/checksum. **Not wired as `package.json`'s published `bin` entry.** Four existing install/acceptance tests (`tests/acceptance/global-install.test.mjs`, `packed-install.test.mjs`, `tests/functional/install-scope.functional.test.mjs`, and `install-parity.functional.test.mjs`) spawn `node bin/construct ...` directly and assert on synchronous, network-independent stdout within tight timeouts; flipping the `bin` mapping needs those updated deliberately (mocked binaries or an offline-first fallback) so a real `npm install -g` does not regress into a flaky, network-dependent install. The shim's own logic is covered by `tests/functional/construct-shim.functional.test.mjs` — cache hit/miss, checksum mismatch, network failure, and the `CONSTRUCT_BIN_OVERRIDE` and unsupported-platform fallback paths, the latter proven against the real `bin/construct` CLI, not a stub.

**What is genuinely verified vs. what is not (be precise here — do not restate this as "done")**:

- Verified directly on this machine: `bun build --compile` for `darwin-arm64`, executed, `construct doctor` and `construct sandbox create/list/delete` (the CI smoke workflow's demo flow) both produce real, correct output against the compiled binary.
- Verified by cross-compilation only, not execution: `darwin-x64`, `linux-x64`, `linux-arm64` binaries build successfully but have not been run on their native architecture from this environment.
- Not verified here (needs real infrastructure): the GitHub Actions matrix itself (predicted to pass from a local dry run of its exact commands, not observed running in CI); `scripts/install.sh` against a real GitHub Release and a clean VM; a real `npm install -g` of a shim-based package from the npm registry; the Bun binary's behavior on Windows (unsupported — no target exists) or on any Linux distro other than whatever `ubuntu-latest`/this dev machine represent.

## Branch flow: feature → staging → main

Construct uses the standard environment-promotion model. Promotion flows **upward** —
work integrates on `staging` (pre-production) and is promoted to `main` (production).

| Branch | Role | Deploys to |
|---|---|---|
| feature / `fix/*` / `research/*` | unit of work | — (CI only) |
| `staging` | integration / pre-production gate | staging environment (when provisioned — see below) |
| `main` | production | `construct-production` via `deploy.yml` on push to main |

### How work ships

1. **Branch off `staging`** and do the work.
2. **Open a PR into `staging`.** CI must pass (`ci-required`, `secret scanning`); merge when green. This is the integration gate — multiple features land here and are validated together before production.
3. **Promote to production** with a single `staging → main` PR. Merging it is the deliberate, reviewed step that triggers the production deploy. Open the promotion PR on demand:

   ```bash
   gh workflow run "Promote staging → main"
   # or manually:
   gh pr create --base main --head staging --title "release: promote staging → main"
   ```

`main` is never targeted by feature PRs directly. A hotfix that must bypass `staging` is an explicit, documented exception (PR straight to `main`), not the default.

### Staging full-matrix gate (construct-wrfcx)

`ci.yml` only runs the full OS×Node matrix on push-to-main / schedule / `workflow_dispatch`; PRs and pushes to `staging` ran a single ubuntu runner + lint, so `staging` could diverge from `main` for days with platform/engine failures uncaught until release (17 days in the incident that opened this bead). Two enforced mechanisms close the gap:

1. **Daily full matrix on `staging`** — `.github/workflows/staging-full-matrix.yml` runs the same `test` legs (ubuntu/macos × Node 20/22 × shards) plus the lint suite against the `staging` ref every day at 09:17 UTC (and on `workflow_dispatch`). A red run notifies repo watchers by default, so a broken matrix on `staging` surfaces within ~1 day, not at release time.
2. **Promotion guard** — `Promote staging → main` (`.github/workflows/promote-staging-to-main.yml`) will not open or refresh the `staging → main` PR unless the most recent `staging-full-matrix` run concluded `success`. A red staging matrix therefore blocks the promotion before production is at risk.

If promotion fails with `Refusing to promote: staging full matrix is not green`, fix `staging`, wait for the next scheduled run (or trigger `staging full matrix` via `workflow_dispatch`), and re-run the promote workflow once it is green.

### Staging deploy (follow-up)

`staging` is the pre-production gate but does not yet have its own deploy target — only
production (`main`) deploys today. Provisioning a staging environment (a parallel ECS
service + Terraform workspace under `deploy/terraform/environments/staging`, deployed on
push to `staging`) is the remaining step to make `staging` a true running pre-prod mirror.
Until then, `staging` gates by CI + review, not by a live environment.

> Historical: a `sync-main-to-staging` workflow previously mirrored `main` *into* `staging`
> (the inverse, downstream direction). It was removed when adopting this model — staging now
> leads main, not trails it.

## Pre-push gate (local, runs before every push)

`lib/hooks/pre-push-gate.mjs` runs before any `git push`:

- `npm test`
- `npm audit --omit=dev --audit-level=high`
- `node bin/construct evals retrieval`
- `node bin/construct docs:verify`
- `npm run lint:scopes --quiet`

Failures here block the push. There is no bypass env var: fix the underlying issue (or, for the SHA-aware re-push check, add a fix commit so HEAD advances past the rejected SHA).

## When something fails

| Symptom | Likely cause | Fix |
|---|---|---|
| npm publish 404 / ENEEDAUTH | OIDC misconfiguration; `setup-node` injected `github.token` | Confirm `registry-url` is **not** in the setup-node step; re-verify Trusted Publishers on npmjs.com |
| Homebrew bump fails to push | `HOMEBREW_TAP_TOKEN` lacks push perms | Regenerate the token with write access to `geraldmaron/homebrew-construct` |
| `release:check` fails on `docs:verify` | New code without doc update | Update the affected doc, regenerate AUTO regions, recommit |
| Docker CVE scan blocks release | New high/critical CVE | Bump the affected dep or wait for an upstream patch; do not lower the severity threshold |
| Trivy `@master` warning | Action drifted off pinned version | The action is intentionally pinned to a specific `v0.x.y` release; ignore the prompt to use `@master` |
| `Sync main → staging` fails with `not permitted to create or approve pull requests` | Repo policy "Allow GitHub Actions to create and approve pull requests" is off | Enable in Settings → Actions → General → Workflow permissions (or `gh api -X PUT /repos/<owner>/<repo>/actions/permissions/workflow -F can_approve_pull_request_reviews=true`); re-run via `gh workflow run "Sync main → staging" --ref main` |
| Sync PR has no CI checks; branch protection blocks merge | Sync workflow pushed via `GITHUB_TOKEN` (anti-loop guard); downstream CI never fires | Set the `SYNC_PR_TOKEN` repo secret (fine-grained PAT) so future syncs trigger CI. For the current PR, admin-merge OR push an empty commit to the sync branch |
| `npm audit` fails the release gate on a workspace-scoped dep | Release gate is mis-scoped (was running with no `--workspaces=false`) | Confirm `release.yml` uses `--omit=dev --audit-level=high --workspaces=false` to match `ci.yml`. Workspace-scoped vulns (apps/docs, dashboard) belong on their own remediation track, not the CLI release gate |

## Patterns codified (so we do not redo this manually)

- **No manual release-state docs.** This file is the canonical reference. Any release-flow change updates this doc in the same PR.
- **Preflight before push.** `npm run release:preflight` is the contract; CI is the backstop.
- **OIDC, no stored tokens.** Trusted Publishers settings are documented; no secret rotation needed.
- **Doctor as a release gate.** `construct doctor` runs in CI before artifacts ship. Adding a check to doctor automatically gates the next release.
- **lint:scopes + functional tests** all run in CI; new categories of gate (e.g. when a B4 ships) follow the same wiring pattern.
- **All artifacts on a tag push.** Tagging is the one action that ships everything; no separate "release the docker image" step exists.
- **Tests/AUDIT.md is refreshed when the suite passes 2000 tests or a new top-level test category lands**, not every PR.
- **Release-policy** in `docs/operations/maintenance/release-policy.md` captures what counts as a release (vs a doc tweak that does not need a version bump).

## When this doc itself is out of date

Symptoms: a release step that runs in CI but is not listed here; a workflow file added in `.github/workflows/` without a row in the table at top. Fix by editing this doc in the same PR that adds the workflow. The contract is: every release-affecting change updates this file.
