<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0059: Dependency-intent rubric and removal/quarantine policy — LMCP-A9

- **Date**: 2026-07-03
- **Status**: accepted
- **Deciders**: Gerald Dagher (owner), Construct maintainers (cx-architect)
- **Relates to**: ADR-0001 (zero-npm-core), ADR-0024 (document-io optional capability), ADR-0052 (unified provider manifest)
- **Tracking**: LMCP-A9

## Problem

Dependencies have no declared owner, mode requirement, removal criteria, or health-check contract. The npm dependency graph, optional dependency list, and binary sidecars (docling, whisper, pandoc, typst, LibreOffice) are invisible to the runtime: `construct doctor` does not verify them, `construct status` does not report their availability, and no policy governs when a dependency can be added, retained, or removed.

The evidence:

- `package.json` — deps and optionalDeps list contains entries whose owning workflow, mode requirement, and degradation behavior are undocumented
- `docling` is provisioned via a `uv` virtual environment outside npm; its presence is not verified by `construct doctor` and it is not listed in any manifest
- `lib/demo-surface.mjs` references `playwright` in code but `playwright` is not declared as a dependency in `package.json`, making it an implicit ambient dependency that will silently fail in any clean install
- `lib/document-export.mjs` — `FORMAT_ENGINES` requires `pandoc` and `LibreOffice` binaries to be present on the system PATH; their absence is not surfaced to the user until a document export fails at runtime
- `@huggingface/transformers` is listed as an optional dependency with a hashing fallback, but the degradation behavior and the security surface (network access, model download) are not documented
- No process exists for quarantining a dependency that is present but unintentional; unintentional deps accumulate and become load-bearing without a formal removal path

## Decision

Every dependency — npm dep, optionalDep, binary sidecar, devDep — must satisfy the intent rubric before it may be added or retained. Existing dependencies are triaged against the rubric in LMCP-K beads.

### Intent rubric

All fields are required for core and optional deps. A subset (purpose, owningWorkflow, installPath, removalCriteria) is required for dev deps. Binary sidecars must additionally declare healthCheck and degradationBehavior.

| Field | Description |
|-------|-------------|
| `purpose` | What user-visible feature does this dependency enable? |
| `owningWorkflow` | Which workflow(s) or bead(s) require it? |
| `installPath` | `npm dep` \| `optionalDep` \| `binary-sidecar` \| `devDep` |
| `modeRequirement` | `solo` \| `team` \| `enterprise` \| `all` |
| `healthCheck` | How does `construct doctor` detect presence and version? |
| `degradationBehavior` | What happens if absent: `error` \| `graceful-skip` \| `silent` |
| `securityConcerns` | Network access? Code execution? Supply-chain risk? Model download? |
| `removalCriteria` | What conditions would trigger removal of this dependency? |

The rubric is maintained in `deps/intent.json` — a JSON file keyed by package name or binary name, with one entry per dependency. `construct doctor` reads this file and cross-references it against the actual installed set, warning on any dep present in `node_modules` or on `PATH` that lacks an intent entry.

### Disposition options

Each dependency must carry one of the following dispositions in `deps/intent.json`:

| Disposition | Meaning |
|-------------|---------|
| `core` | Always required; install failure is a hard error; `construct doctor` exits non-zero if absent |
| `optional` | Graceful degradation if absent; `construct doctor` warns but exits 0; capability is skipped |
| `provider-plugin` | User-installed per ADR-0052 manifest; not bundled in the core package |
| `dev` | CI and build tooling only; must not appear in the consumer install artifact |
| `replace` | Deprecated in favor of another dep; replacement is named in the intent entry; still present for backward compatibility |
| `quarantine` | Present but unintentional or pending removal; must not be used in new code; scheduled for removal in a named release |
| `remove` | No user-visible feature depends on this dep; a removal bead is filed; removed in the next release |

### Quarantine mechanism

A file `deps/quarantine.json` lists quarantined packages with:

```jsonc
{
  "package-name": {
    "reason": "string — why it is quarantined",
    "filedBead": "string — bead id for the removal work",
    "targetRelease": "string — semver range or release name when removal is planned",
    "addedAt": "ISO 8601 date"
  }
}
```

An ESLint rule — either `no-restricted-imports` configured in `eslint.config.js`, or a custom rule at `eslint-rules/no-quarantined-imports.mjs` — reads `deps/quarantine.json` and raises an error on any new `import` or `require` of a quarantined package. This prevents new code from acquiring a dependency on a dep scheduled for removal.

`construct doctor` reports each quarantined package as a warning (not an error): `"[warn] <package> is quarantined (see deps/quarantine.json) — do not use in new code"`.

### Specific dispositions (immediate, applied in LMCP-K1)

The following dispositions are decided by this ADR and must be applied without waiting for the full rubric triage of all other deps:

| Dependency | Disposition | Rationale |
|------------|-------------|-----------|
| `playwright` | `quarantine` | Referenced in `lib/demo-surface.mjs` but not declared in `package.json`; no install path; file a removal bead targeting `demo-surface.mjs` cleanup |
| `docling` | `optional` binary-sidecar | Provisioned via `uv venv` outside npm; `construct doctor` health-check command: `uv run docling --version`; degradation: `graceful-skip` (document ingestion unavailable) |
| `pandoc` | `optional` binary-sidecar | Required by `FORMAT_ENGINES` in `lib/document-export.mjs`; doctor checks `pandoc --version`; degradation: `graceful-skip` (affected export formats unavailable) |
| `typst` | `optional` binary-sidecar | PDF engine used alongside pandoc; doctor checks `typst --version`; degradation: `graceful-skip` (PDF export unavailable) |
| `LibreOffice` | `optional` binary-sidecar | Required for `.doc` and `.odt` export; doctor checks `soffice --version`; degradation: `graceful-skip` (legacy Office formats unavailable) |
| `whisper` | `optional` binary-sidecar | Audio transcription; doctor checks `whisper --version` or Python import; degradation: `graceful-skip` (audio ingest unavailable) |
| `@huggingface/transformers` | `optional` npm dep | Already has hashing fallback; document degradation path and network/model-download security concern in intent entry |

### Doctor integration

`construct doctor` is extended with a `deps` check that:

1. Reads `deps/intent.json` and `deps/quarantine.json`
2. For each `core` dep: verifies presence; exits non-zero if absent
3. For each `optional` dep with a `healthCheck`: runs the health check; warns if absent or version mismatch
4. For each `binary-sidecar` dep: runs the declared health-check command; warns if the command fails
5. For each `quarantine` entry: emits a warning
6. For any dep in `node_modules` or on `PATH` that is not in `deps/intent.json`: emits a warning (`"unlisted dep: <name> — add to deps/intent.json"`)

The doctor check does not fail on `optional` or `quarantine` entries — only on `core` absences and unlisted deps that are actively imported.

## Alternatives considered

- **Inline comments in `package.json`**: annotate each dep with a comment explaining its purpose. Rejected because `package.json` does not support comments in standard JSON (ADR-0028 documents the js-yaml exception, which does not apply here), and comments in `package.json` break tooling.

- **README table of dependencies**: maintain a markdown table of all deps. Rejected because it diverges from the actual `package.json` on every dep change and is not machine-readable by `construct doctor`.

- **Enforce intent via a custom npm lifecycle script**: block `npm install` of undeclared deps. Rejected because it is too coarse — it would block legitimate additions before they can be classified — and it does not address the binary sidecar problem.

- **Remove all sidecars and replace with cloud APIs**: replace docling, pandoc, typst, LibreOffice with hosted equivalents. Rejected for ADR-0001 (zero-npm-core / local-first) reasons; user-controlled local execution is a design invariant.

## Consequences

- `deps/intent.json` and `deps/quarantine.json` are created in LMCP-K1; every current dep is triaged and assigned a disposition.
- `playwright` is immediately quarantined; `lib/demo-surface.mjs` is flagged for cleanup; no new code may import it.
- `construct doctor` gains a `deps` check that validates binary sidecars, warns on quarantined packages, and errors on unlisted imported deps.
- The ESLint rule blocks new code from importing quarantined packages; any PR that adds an import of a quarantined package fails linting.
- New deps added after this ADR are accepted only if they carry an intent entry; the PR template is updated to include a `deps/intent.json` checklist item.
- Unblocks: LMCP-K1..K6 (dependency triage, doctor integration, quarantine enforcement, and sidecar health-check beads).
