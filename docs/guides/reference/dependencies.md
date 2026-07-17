# Dependency Policy

## Zones

### Core zone: `lib/`, `bin/`

**Allowed:** Node.js built-ins (`node:fs`, `node:path`, `node:crypto`, etc.) plus the ADR-sanctioned runtime dependencies tracked in `tests/core-dependency-policy.test.mjs`'s `SANCTIONED` allowlist:
- `@modelcontextprotocol/sdk`: MCP server/client protocol
- `@lancedb/lancedb` + `apache-arrow`: vector storage backend (retain-as-canonical decision, `construct-tsyfe.7.2`)
- `js-yaml`: markdown frontmatter parse/emit only (ADR-0028)
- `mailparser`: RFC 5322/MIME email parsing only (ADR-0098)

**Not allowed:** Any other npm package without an ADR (see below).

### Services zone: `services/`

Additional runtime dependencies are allowed. Each new dependency requires an ADR in `docs/decisions/adr/` answering:
1. What in-tree code does it replace?
2. What is the maintenance cost of keeping the in-tree version vs. adopting the library?
3. What is the security surface (weekly downloads, known CVEs, supply chain history)?

### Tooling zone: `tests/`, `scripts/`

Dependencies are allowed freely. No ADR required. These never ship to end users.

## Adding a core dependency

1. Write `docs/decisions/adr/NNNN-<title>.md` using the MADR template (see `docs/decisions/adr/0001-zero-npm-core.md` for format).
2. Answer all three questions above in the ADR body.
3. If the candidate falls into one of ADR-0097's named delegation classes (markdown/HTML parsing, MIME/RFC message parsing, schema validation, graph/diagram rendering), apply its lifecycle-cost rubric explicitly — install footprint, maintenance burden transferred, security surface, replaceability, evidence bar — citing the class's standing verdict rather than re-arguing whether the class is delegable at all. See `docs/decisions/adr/0097-capability-delegation-rubric.md`.
4. PR must link the ADR. Reviewer confirms the ADR is complete before approving the dependency addition.

## Promotion trigger

Any in-tree implementation that accumulates **3 or more defects in a 6-month window** automatically nominates itself for library replacement review. Create a GitHub issue linking the defects and the relevant section of `docs/in-tree-implementations.md`.

## In-tree implementation inventory

See `docs/in-tree-implementations.md` for the full list of hand-rolled components, their LOC, test coverage, known limitations, and nearest library alternatives.

## Transitive vulnerability remediation

When `npm audit` reports a vulnerability in a transitive dependency of the published CLI, follow this ladder. Higher rungs are preferred — they fix the tree consumers actually install.

**The load-bearing rule:** an `overrides`/`resolutions` pin in this `package.json` protects only this repo's own audit. npm applies `overrides` solely for the top-level project doing an install, so a published library's overrides are ignored by everyone who depends on it. Never rely on `overrides` as the consumer remedy, and never treat a green repo audit as proof the published artifact is clean — that is what `npm run audit:published` checks (it packs the artifact and audits a clean downstream install with no overrides in scope).

Remediation ladder:

1. **Bump the offending direct dependency** to a release line whose transitive graph is already patched.
2. **Replace or remove the direct dependency** when the maintained successor resolves a clean tree (e.g. `@xenova/transformers` → `@huggingface/transformers`).
3. **Demote to `optionalDependencies` or a peer** so a non-essential heavy dependency leaves the default install surface — only when an in-tree or hosted fallback exists (see [ADR 0014](adr/0014-local-embeddings-optional.md)). Optional deps are still installed and audited by default, so this complements but does not substitute for rungs 1–2.
4. **Accept with a documented ADR** only when no upstream fix exists, recording the residual risk and the revisit condition.

A repo-local `overrides` pin is acceptable as defense-in-depth for this repo's own tree, but it is never the line item that closes a consumer-facing advisory.

## External binary, sidecar, and model provenance

Construct shells out to a set of external binaries, a Python sidecar, and
downloaded ML models that npm audit and `deps/intent.json` do not cover
(neither is a package in `package-lock.json`). Each is recorded as a
Provider Card in `registry/provider-cards.json`, validated against
`schemas/provider-card.schema.json` (`node scripts/validate-provider-cards.mjs`),
per construct-tsyfe.10.3:

| Provider | Kind | Pin mechanism |
|---|---|---|
| `pandoc`, `typst`, `d2`, `dot`, `soffice`, `vhs`, `ffmpeg` | `binary` | User-installed (Homebrew/apt); `versionPolicy.expectedVersion` records a reference version and `lib/providers/binary-health.mjs`'s `checkBinaryVersion` warns (never hard-fails) on drift. |
| `docling` | `sidecar` | Genuinely pinned: `lib/runtime/docling-runtime/pyproject.toml` + committed `uv.lock` (118 packages, checksummed); `lib/runtime/uv-bootstrap.mjs` provisions via `uv sync --frozen`, which fails rather than silently re-resolving if the two files drift apart. `DOCLING_PIN` in that module must match the lockfile's `docling==` pin — `tests/functional/docling-venv-pin.functional.test.mjs` asserts this. |
| `whisper` (whisper.cpp CLI) | `sidecar` | Unmanaged — no upstream release channel to pin against; presence/health only. |
| `docling-models` | `model` | Downloaded by the pinned `docling` package itself; Construct does not independently track the HF model revision docling requests (documented gap, not a fabricated pin). |
| `local-embedding-model` (`Xenova/all-MiniLM-L6-v2`) | `model` | `lib/storage/embeddings-local.mjs` requests an explicit, overridable HF revision (`CONSTRUCT_EMBEDDING_MODEL_REVISION`, default `main`) instead of an implicit default; no commit SHA is pinned yet pending a live Hub lookup. |

A version-identity mismatch on any of these is additive: it layers a warning
on top of the existing presence/absence check and does not change any
degradation behavior (D2→dot→source, docling→node-native→refuse, etc. are
unchanged).

## Rationale

See `docs/decisions/adr/0001-zero-npm-core.md` for the original decision record.
