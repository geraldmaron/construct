# Release verification

[Documentation index](README.md) · [Project README](../README.md)

## Local delivery

A delivery candidate is an installable numbered alpha, exercised through Claude
Code and Codex using subscription access. It carries bounded delivery assurance,
not broad effectiveness, semantic correctness, or live parity across all hosts.
No benchmark matrix or private evaluation corpus is a prerequisite.

Run the real deterministic gate:

```bash
npm run lint && npm run typecheck && npm test && npm run smoke
npm run conformance
```

Then pack the final source once with `npm pack --pack-destination <bundle>`.
Use `npm run smoke -- --tarball <candidate.tgz>` to check those exact bytes.
Install that candidate in isolated projects and run one sequential walkthrough
in each of Claude Code and Codex: ordinary answer, local claimed edit, supplied
plan managed outcome, invalid submission followed by recovery, and accurate
assurance presentation. Record actual identity, completion, protocol observations
and available usage. Other hosts receive static/simulated contracts and remain
live-unmeasured. Fix defects and rerun the checks invalidated by the change.

The external delivery bundle contains the tarball, SHA-256 checksum, manifest,
two host receipts, sanitized observations and check logs. Raw model transcripts
remain local. Receipts bind the package version, source digest, model-facing
surface digest and tarball checksum. Any product or verifier change invalidates
them. Generated evidence is outside the package, avoiding self-referential hashes.

```bash
npm run release:check -- --manifest=<bundle/manifest.json> --tarball=<bundle/candidate.tgz>
```

The default delivery tier fails if a required check, host, scenario or evidence
hash is absent or stale. It also checks the package identity against the checkout.
A clean checkout can reproduce code checks and validate the supplied bundle;
subscription-backed host observations are external evidence, not reproducible
model judgments. The gate validates recorded evidence and bindings; it is not an
independent attestation that a maintainer's observations are truthful.

## Assurance and evaluation ownership

Commit sterile deterministic tests, fixtures, parsers and scorers that protect
product contracts. Keep private/held-out data, generated results, raw host traces
and assessment histories outside the repository and npm package. Use shared
verification utilities rather than local-only copies. Do not delete failing cases
to obtain a pass, or restore removed workflow aliases to satisfy stale fixtures.

The qualified and experimental-alpha tiers are retired and fail with an explicit
recovery message. The old model-run release command is removed. Historical
manifests remain bounded records outside this checkout; they cannot satisfy
current delivery. Historical tags retain their original content,
including older evaluation material. Removing files from current main or a package
does not remove them from reachable history. No history rewrite is required.

### Public source identity

The source digest is domain-separated as `construct-public-source-v2`. It binds
the public runtime, skills, workflows, registry, scripts, tests, docs, CI and Git
hooks, plus the required root package, instruction, policy and build files. The
input lists are declared in `scripts/delivery-evidence.mjs`. A missing required
file or directory is an error naming that input; it is never skipped.

The earlier input set included this checkout's strategy and local MCP/host
configuration. Those private or generated files are no longer release inputs.
Portable `CLAUDE.md`, security and glossary documentation, and Git hooks are now
explicit inputs. Local identity, host wiring, datasets and session notes stay
outside this contract. Two clean checkouts must compute the same digest.

This change invalidates earlier source-bound delivery evidence. Preserve old
receipts unchanged as historical records; do not re-label them or attach them to
new bytes. Deterministic cleanup checks alone do not establish a new live-host
delivery receipt or authorize publication.

Structural checks establish citation and arithmetic properties within their
stated scope. Arithmetic does not establish semantic attribution. Observed commands,
native semantic reviews and human acceptance are reported separately. An unavailable
reviewer remains unavailable, with its reason; it is never counted as a pass.

## Public release

Local delivery does not authorize a merge, tag, push or npm publication. When
public release is explicitly directed, use the already-verified delivery bundle.
Attach it as `construct-delivery.zip` to the GitHub release for the approved tag.
The release job downloads the bundle, checks its source and package identity,
runs deterministic checks and smoke against its candidate, validates the receipts,
and publishes that same tarball with provenance under `alpha`. It does not repack
or move `latest`. A missing bundle or retired assurance tier fails closed.
