# Release policy

> Operational sibling: `docs/operations/maintenance/release-and-deploy.md` describes what fires when you tag. This doc describes when to tag at all.

Construct ships when a user-visible change is ready and verified. Releases are deliberate, not reflexive. Most merges to `main` are not releases.

## What counts as a release

A release happens when all four of these are true:

1. `package.json` `version` is bumped.
2. `CHANGELOG.md` has an entry for the new version describing the user-visible change.
3. A `vX.Y.Z` git tag matching `package.json` is pushed to origin.
4. The tag push triggers `.github/workflows/release.yml`, which builds SEA binaries for linux/darwin/windows × x64/arm64, builds and pushes the Docker image, and runs `npm publish --provenance --access public` via npm Trusted Publishers (OIDC. no static `NPM_TOKEN` secret required).

The tag is the trigger. If you don't tag, nothing publishes.

## What does not count

These changes flow into `main` without a version bump:

- Doc-only edits.
- Internal refactors that don't change consumer-visible behavior or the bundled artefacts.
- Test additions and fixes.
- CI / tooling changes that don't affect the published package.
- Dependency bumps that don't bubble up through any public surface.

A user-facing rule of thumb: if a peer who runs `npm install` next week would observe the change, it's a release. If they wouldn't, it isn't.

## Cadence

No calendar-driven releases. No auto-tagging on merge. Ship when something is ready and worth a peer's `npm update`.

## Pre-release tags

When a change is risky, breaks the API, or needs external testers before going stable, ship it as a pre-release first. The pattern is documented in `docs/operations/maintenance/release-and-deploy.md` § Pre-release channels. In short:

- `v1.0.5-alpha.N` for early experiments
- `v1.0.5-beta.N` for feature-complete but bug-likely
- `v1.0.5-rc.N` for release candidates
- `v1.0.5` for stable

The workflow handles routing: pre-releases publish to a non-`latest` npm dist-tag, get a non-`latest` Docker tag, skip the Homebrew bump, and are marked pre-release on GitHub. `npm install` keeps installing the stable line. Opt-in consumers use `npm install @geraldmaron/construct@alpha` (or `@beta`, `@rc`).

Use a pre-release when you would otherwise hesitate to ship a stable tag.

## Versioning during 0.x

The project is explicitly pre-stable. Breaking changes are allowed in minor bumps (`0.1.x` → `0.2.0`). Patch bumps (`0.1.0` → `0.1.1`) are for fixes and additive changes that don't break existing consumers.

A `1.0.0` will land when:

- The CLI surface, hook contract, and `specialists/org` shape are stable enough that we want to commit to semver discipline.
- The dep-install path is exercised by several real downstream projects.
- The release pipeline (`.github/workflows/release.yml`) has fired end-to-end and produced working binaries + a working `npm install`.

Until then, expect 0.x volatility. pin to `~0.1.x` if you want to opt into patches only.

## Manual one-off publishes

Most of the time, tag-driven releases via the workflow are the only path. The exception is administrative version moves (the v0.1.0 reset that re-anchors `latest` away from the prematurely published `1.0.0`). For those, publish manually with `npm publish --provenance --access public --tag latest` and use `npm dist-tag` to fix tags rather than firing the release pipeline. Document the manual move in the CHANGELOG.

### npm Trusted Publishers (one-time setup)

The release workflow uses npm's OIDC-based Trusted Publishers. **no static `NPM_TOKEN` secret is needed or stored**. npm detects the GitHub Actions OIDC environment (`ACTIONS_ID_TOKEN_REQUEST_URL`, provided by `id-token: write`) and exchanges the token with the npm registry automatically. No `NODE_AUTH_TOKEN` is set in the workflow; the registry verifies the OIDC token against the configured Trusted Publisher entry.

**npm CLI version requirement**: npm CLI 11.5.1+ is required for Trusted Publishers OIDC. Node 22 ships with npm 10.x, which does not support OIDC-first auth and falls back to `NODE_AUTH_TOKEN` (injected by `setup-node@v6` as `github.token` when `registry-url` is set). a GitHub token is not a valid npm publish token, causing a 404. The workflow uses Node 24 in the publish job because Node 24 ships with npm 11+, which tries OIDC before any token fallback. With npm 11+, `registry-url` is safe.

**One-time setup on npmjs.com:** package → Settings → Trusted Publishers → add GitHub Actions → set owner/repo to `geraldmaron/construct` and workflow file name to `release.yml`. Until this is configured, `npm publish` in the workflow will fail with an auth error.

### Pre-release preflight (run locally before tagging)

```bash
npm run release:preflight             # full check including npm auth
npm run release:preflight:no-auth     # skip npm auth (if not logged in locally)
```

The preflight script checks: clean git tree, on main, CHANGELOG entry exists, tests pass, comment policy, docs verify, npm audit, and `npm pack --dry-run`. Run it before `git tag`. not after. If it passes locally, CI will pass.
