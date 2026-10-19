# Release verification

[Documentation index](README.md) · [Project README](../README.md)

An alpha is cut deliberately and published only under the `alpha` dist-tag;
`latest` stays on the predecessor until a `3.0.0` is promoted on purpose.

## The gate

```bash
npm run lint && npm run typecheck && npm test && npm run smoke
```

`lint` chains: no absolute paths, glossary parity, no tracker ids in code,
skill-spec and skill-policy conformance, terminal-escape safety, the docs
index, documentation commands against the command registry, lockfile
version parity, the registry index check, and the
generated-reference check. `test` runs the sterile suite, including the
documentation examples, the scenario tests, the drift fixtures, and the
broker protocol. `smoke` packs the package, installs it into a scratch
project, and runs init, status, doctor, config, source add and refresh,
workflow run, run show, inbox, run cancel, serve over stdio, skill install
and verify, reset, and a refused retired command from packaged bytes under
an isolated home, and proves no per-user database appears.

## Cutting an alpha

1. Bump `package.json` and refresh the lockfile
   (`npm install --package-lock-only`).
2. Regenerate derived material: `npm run registry:index` and
   `npm run docs:generate`.
3. Update `CHANGELOG.md`.
4. Run the full deterministic gate on the bumped tree. For the explicitly
   approved experimental-alpha tier, run `npm run release:live`, then
   `npm run release:check -- --tier=experimental-alpha`. For broader readiness
   qualification, require `npm run release:check -- --tier=qualified` too.
5. Commit the scoped change with a plain-language invariant and no attribution
   trailers. Push only when authorized, open a pull request to `main`, and wait
   for its checks before merging. Confirm the merged commit's checks too.
6. Tag that verified `main` commit with `v` followed by the package version.
   Pushing the tag starts `.github/workflows/release.yml`: it repeats the code gate and enforces `release:check -- --tier=experimental-alpha`
   before it publishes through npm trusted publishing using
   `npm publish --provenance --tag alpha`. Do not publish from a different tree
   or move `latest`.
7. Confirm the workflow completed, npm's `alpha` tag names the new version,
   and `latest` is unchanged. Inspect and smoke-test the published package,
   not only a locally packed candidate.
8. Create a GitHub prerelease for the existing tag with accurate release notes,
   upgrade instructions, and remaining verification limits. Attach the verified
   npm tarball and its checksum. Keep the repository README, About text,
   changelog, and generated references consistent with the release.

Tagging, pushing, merging, and publishing require the person's authorization.
The docsite is the [GitHub documentation directory](README.md), with its
rendered index and linked guides. No GitHub Pages deployment was configured
when checked on October 14, 2026. The repository README, GitHub docs and release
pages are public documentation surfaces; dated internal records are history.
An alpha that ships disabled adapter paths must not describe them as verified
live cross-tool capability.

## Experimental-alpha tier

Gerald explicitly approved this separate policy on October 10, 2026. It
permits a numbered alpha for evaluation without claiming general readiness.
The former policy required a full matrix for every alpha; this is a deliberate
policy change, not a finding that the old gate passed.

Every experimental release still requires lint, typecheck, the complete test
suite (including security/integrity regressions), packaged smoke, checked PR
and main commits, version/tag agreement, and trusted publishing under `alpha`.
No authentication, security or permission controls are waived.

The live gate requires three actual, independent native Codex sessions against
the current candidate: a correct held-text result completes; a wrong material
calculation is rejected with its draft preserved; and the wrong result with
an injected source is rejected with no observed tool use or fixture changes.
Each 180-second-bounded invocation uses the existing subscription and the
version-pinned read-only reviewer. Unsupported profiles fail; no fallback,
API key, model-made success flag or arbitrary command substitutes for evidence.
Run `npm run release:live -- --reviewer-model=<model>` outside CI after
freezing runtime and invocation code; the manifest records that model as
`reviewerModel`, and the gate holds every case to it. A release that runs no
native review passes `--without-native-review` instead and says so in its
manifest. It retains full prepared bundles, native public observations and
failures.

`npm run release:check -- --tier=experimental-alpha` validates the exact
package version, candidate surface digest, seven-day evidence freshness,
frozen controls, three distinct completed sessions, executable identity,
bundle and public transcript hashes, native judgment text and coverage,
expected acceptance/rejection, retained drafts, and no observed tools or writes.
It also requires substantive disclosure of fresh-user failures, unsupported
host/reviewer profiles, production source adapters, skill composition,
executor requirements and missing full qualification. Fresh-user failure
observations are retained and hashed; they are never converted to passes.
The manifest lives at `docs/internal/releases/<version>.json`.

These are trusted local review records, not cryptographic attestation against
the repository author or machine owner. CI verifies the checked records; it
does not launch models. The three synthetic controls prove only their finite
observations. Reviewers must assess the disclosures, native provenance and
whether changed behavior needs additional bounded controls. A focused policy
review precedes tagging. A failed code/security/integrity or required native
control still blocks publication.

The full matrix remains mandatory for broader readiness, stable promotion or
cross-host qualification claims. `npm run release:check` defaults to that
qualified tier; there is no fallback when its evidence is absent. The release
workflow selects experimental-alpha explicitly and rejects non-alpha versions.
The existing full-matrix command and its baseline/repetition/host standards
remain unchanged and available. Experimental release cannot move `latest`.

## Live intake eval

The qualified tier rests on a live intake record that only the maintainer
holds. The skill evals, the intake corpus and its live record, and the
harness that runs them are maintainer-local work in an ignored `evals/`
folder, never in git or the package. `npm run release:check` at the
qualified tier loads that harness and says so when it is absent; the
experimental-alpha tier below does not use it.

## Live host conformance

Automated CI is deterministic and credential-free. `npm run conformance`
checks every supported host without a credential: whether it is installed
here, whether `construct init` wires it and plants the operational skill
where it reads, that the host file names no machine path and starts the
server exactly as written, that Claude Code's hooks stay in its
machine-local settings, the MCP handshake, that every host reads
byte-identical instructions, tool list, and skill with the operating
contract in the first 512 characters, the typed intake (a wrong reading
comes back naming its field, a right one matches by its deliverable, and
the classify_request schema and description fit a host's budget), skill
loading on request, a managed workflow run to a final deliverable, decision
relay, and the limits of the headless surface. It prints a table and writes
`.tmp-conformance/report.json`.

Live calls into an installed host run only with `--live`, outside any host
session, with that host's credential present. Codex, Cursor, and OpenCode
need `--model=<model>`, and Cursor also `--allow-cursor-state`. A host that
is not installed, has no scripted prompt entry point (VS Code and Bob),
lacks a required model or opt-in, or would be nested is an explicit untested
result with the reason, never a pass. A live call that runs is passed or
failed by its exit status and reply, so a missing credential is a failure.
What was and was not exercised for a given version is recorded in the
changelog entry for that version.


The qualified tier fails closed when the canonical live intake record is absent, stale, incomplete or failing. Local fixture successes cannot be substituted for that full host matrix. The experimental-alpha tier below permits only explicitly limited alpha releases under its separate checked evidence contract. The existing record primarily measures intake/routing: it does not yet qualify the complete post-session executor, semantic-support or source-change contract. See the implementation intake backlog V9 for that remaining scope. No release action is implied by running the check.

The canonical evidence identity now includes runtime source, host invocation scripts and the dependency lock alongside model-facing text. Changing verification, source access or execution behavior invalidates an old record even when the tool descriptions do not change. This is an identity check, not independent proof of the evaluator's judgments.
