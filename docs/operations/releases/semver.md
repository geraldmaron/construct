# Versioning policy

Construct follows [Semantic Versioning 2.0.0](https://semver.org). Releases
are tagged `vMAJOR.MINOR.PATCH` and published to npm under
`@geraldmaron/construct`.

## What counts as a breaking change (MAJOR bump)

- A change to the schema of `specialists/registry.json`. Adding optional fields
  is non-breaking; removing fields, renaming fields, or changing the
  meaning of existing fields is.
- Removing or renaming any CLI subcommand or flag (`construct foo`,
  `construct bar --baz`).
- Removing or renaming any hook in `lib/hooks/` whose name appears in the
  shipped `platforms/claude/settings.template.json`.
- Removing or renaming any MCP tool surface.
- A change to the plugin contracts (Engine, Provider) that requires plugin
  authors to modify their factory signature or returned shape.
- Any change to the on-disk paths Construct writes to under `~/.cx/`,
  `.cx/`, or `.construct/`.
- A bump to the minimum supported Node version above the previously
  declared `engines.node` floor.

## What counts as a minor bump (MINOR)

- New CLI subcommands, flags, MCP tools, hooks, providers, or engine plugin
  layers.
- New optional fields on existing schemas.
- New built-in resources, providers, or migration steps.
- Performance improvements visible in the eval-retrieval baseline.

## What counts as a patch (PATCH)

- Bug fixes that don't alter the surface area.
- Documentation-only changes.
- CI / tooling adjustments that don't change shipped artefacts.

## Pre-release versions

- `vX.Y.Z-rc.N`: release candidate. Published to npm under the `next`
  dist-tag. Not promoted to `latest` until the corresponding `vX.Y.Z`
  release ships.
- `vX.Y.Z-alpha.N` / `vX.Y.Z-beta.N`: early previews. Not auto-published.

## Deprecation discipline

When we plan to remove or rename surface area, we ship a deprecation
warning at least one minor version before the removal:

1. Add the new surface in version `X.Y.Z`.
2. In the same version, route the old surface through the new surface and
   emit `lib/deprecate.mjs` warnings on use.
3. In `(X+1).0.0` (or later), remove the old surface and document the
   migration in `docs/operations/releases/upgrading.md`.

Deprecation warnings are emitted once per process to stderr in the format:

```
[construct] deprecated: <name> will be removed in vX.0.0. Use <replacement>
```

## CHANGELOG discipline

Every release has a corresponding `## [vX.Y.Z] - YYYY-MM-DD` heading in
`CHANGELOG.md` with sub-headings:

- `### Added`: new surface area
- `### Changed`: non-breaking behaviour changes
- `### Removed`: removed surface area
- `### BREAKING CHANGES`: required for any MAJOR bump; the release
  workflow refuses to publish a major bump without one.
- `### Deprecated`: newly-warned surface that will be removed later

The release workflow extracts the latest section to populate the GitHub
Release notes.

## Release-checking gate

The `release:check` npm script runs before any tag is allowed to publish.
It runs:

1. `construct doctor`: installation + parity checks pass.
2. `npm test`: full test suite, including the retrieval-eval regression.
3. `construct docs:update --check`: auto-generated doc regions are current.
4. `construct lint:comments`: comment-policy compliance.

A failure in any step blocks the publish.
