# Release and deploy automation

> Policy sibling: `docs/maintenance/release-policy.md` describes when to tag. This doc describes what fires when you do.

A consolidated reference for how Construct ships. Every artifact (npm, Docker, binaries, Homebrew, GitHub Pages, AWS smoke) has an automated path; this doc lists them, their triggers, and how to verify each is healthy.

The intent: stop re-deriving the release flow on every cycle. If a step is not automated yet, it is listed here as such, with the bead that tracks it.

## Triggers

| Workflow | File | Trigger | Output |
|---|---|---|---|
| `ci` | `.github/workflows/ci.yml` | push, PR | Tests on Ubuntu/macOS × Node 20/22, comment + prose + profile lints, docs drift, retrieval evals, dependency CVE audit |
| `release` | `.github/workflows/release.yml` | tag `v*` | npm publish (OIDC), Docker image (GHCR), SEA binaries (linux/darwin/windows × x64/arm64), Homebrew tap bump, GitHub Release |
| `pages` | `.github/workflows/pages.yml` | push to main, manual | GitHub Pages docs site |
| `docs` | `.github/workflows/docs.yml` | push to main affecting docs | Auto-regenerates AUTO doc regions |
| `deploy` | `.github/workflows/deploy.yml` | push to main | Container deploy (if configured) |
| `aws-smoke` | `.github/workflows/aws-smoke.yml` | manual | ECS smoke test (gated, optional) |

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

The `version` npm lifecycle script runs `scripts/sync-construct-version.mjs` after the bump and stages `.construct/version` into the same commit, so the npx pin that project-local launchers feed to `npx -p @geraldmaron/construct@<version>` never drifts behind the published release. (A stale pin 404s with `ETARGET` and breaks consumer hooks before any Construct code runs.) The preflight re-asserts the pin with `--check`; to repair drift by hand, run `node scripts/sync-construct-version.mjs`.

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

Validates: clean git tree, on `main`, `.construct/version` pin matches `package.json`, CHANGELOG entry for the version, all tests pass, comment policy, docs verify, npm audit, `npm pack --dry-run`, and (when not `--no-auth`) `npm whoami` against the OIDC environment.

Exit 0 means safe to tag. Anything else: fix locally, do not push the tag and hope.

## Release gate (in CI)

`release:check` job in `release.yml` re-runs the preflight equivalent before any artifact step:

- `npm test` (full suite)
- `node bin/construct doctor`
- `node ./bin/construct docs:verify`
- `node ./bin/construct dashboard:sync --check`
- `node ./bin/construct lint:comments`
- `npm run lint:profiles -- --quiet`
- `npm run test:functional`
- `npm audit --audit-level=high`
- `npm run audit:published` — packs the artifact and audits a clean downstream install with no `overrides` in scope, catching transitive advisories a repo-local override would mask

If any of these fail, no artifacts ship. The prose lint is enforced at PR time only (changed-files scope) and is intentionally not in the release gate; running it `--all` on the current historical baseline would always fail until the cleanup PR (`construct-fj0`, `construct-ze6`) lands.

## npm publish (OIDC, no stored token)

Uses GitHub Actions OIDC + npm Trusted Publishers. **No `NPM_TOKEN` secret is set, stored, or needed.** Configuration:

- `actions/setup-node@v6` is configured **without** `registry-url`. With `registry-url` set, setup-node injects `github.token` as `NODE_AUTH_TOKEN`, which the npm registry rejects with 404.
- `npm config set registry https://registry.npmjs.org/` runs as a separate step.
- `npm publish --provenance --access public` exchanges the OIDC token for a short-lived publish token.

One-time setup on npmjs.com: package → Settings → Trusted Publishers → add GitHub Actions with owner/repo and workflow filename. See `docs/maintenance/release-policy.md` for the full one-time setup. If the publish step ever fails with `ENEEDAUTH`, that setup got reverted or the workflow filename moved.

## Docker image (GHCR)

- Tag pattern: `ghcr.io/geraldmaron/construct:vX.Y.Z` + `:latest`.
- Built and pushed from `release.yml` on every tag.
- Trivy scan in the same workflow fails the release on `CRITICAL` or `HIGH` CVEs.

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

## Sync main → staging (post-merge automation)

`.github/workflows/sync-main-to-staging.yml` opens a sync PR from `main` to `staging` after every push to `main`. The integration branch never falls behind a release that landed via squash.

### Required repo policy

**Settings → Actions → General → Workflow permissions → "Allow GitHub Actions to create and approve pull requests" must be enabled.** Without it, `gh pr create` from the workflow fails with `GitHub Actions is not permitted to create or approve pull requests`. The workflow's `Report token mode` and `Open sync PR against staging` steps surface this error directly with a link to the setting. Verify via:

```bash
gh api /repos/geraldmaron/construct/actions/permissions/workflow
# expect: "can_approve_pull_request_reviews": true
```

### Recommended: PAT (`SYNC_PR_TOKEN`)

Workflows triggered by pushes from `GITHUB_TOKEN` do not fire downstream workflows (GitHub's anti-loop guard), so the auto-opened sync PR sits without CI checks and cannot satisfy branch protection on `staging` without an admin-merge. Set a fine-grained PAT as a repo secret named `SYNC_PR_TOKEN` to bypass this:

1. Generate a PAT with `contents:write` + `pull-requests:write` scoped to this repo (https://github.com/settings/personal-access-tokens).
2. Add it as a repo secret: `gh secret set SYNC_PR_TOKEN`.
3. The workflow picks it up automatically (`secrets.SYNC_PR_TOKEN || secrets.GITHUB_TOKEN` fallback chain).

Without `SYNC_PR_TOKEN`: the sync workflow still runs, opens a PR, and emits a workflow warning that the PR will not auto-trigger CI. Maintainer can admin-merge or push an empty commit to the sync branch to trigger CI.

### Manual re-trigger

```bash
gh workflow run "Sync main → staging" --ref main
```

## Pre-push gate (local, runs before every push)

`lib/hooks/pre-push-gate.mjs` runs before any `git push`:

- `npm test`
- `npm audit --omit=dev --audit-level=high`
- `node bin/construct evals retrieval`
- `node bin/construct docs:verify`
- `npm run lint:profiles --quiet`

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
- **lint:profiles + functional tests** all run in CI; new categories of gate (e.g. when a B4 ships) follow the same wiring pattern.
- **All artifacts on a tag push.** Tagging is the one action that ships everything; no separate "release the docker image" step exists.
- **Tests/AUDIT.md is refreshed when the suite passes 2000 tests or a new top-level test category lands**, not every PR.
- **Release-policy** in `docs/maintenance/release-policy.md` captures what counts as a release (vs a doc tweak that does not need a version bump).

## When this doc itself is out of date

Symptoms: a release step that runs in CI but is not listed here; a workflow file added in `.github/workflows/` without a row in the table at top. Fix by editing this doc in the same PR that adds the workflow. The contract is: every release-affecting change updates this file.
