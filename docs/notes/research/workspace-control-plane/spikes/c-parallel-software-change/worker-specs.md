# Execution-ready work specs — spike C

Three independent, real, low-risk sub-tasks: each adds one missing unit-test
file for one small pure-utility `lib/` module that had zero test coverage
anywhere in the repo (confirmed by `grep -rl <module-name> tests` returning
nothing for all three, before this spike started).

## Sub-task A — `lib/artifact-type-from-path.mjs`

- **File to add**: `tests/artifact-type-from-path.test.mjs`
- **Change**: unit tests for the two exported pure functions,
  `isArtifactGatePath(relPath)` and `inferArtifactTypeFromPath(filePath, { rootDir })`.
- **Acceptance criteria**:
  1. `isArtifactGatePath('docs/specs/prd/foo.md')` → `true`;
     `isArtifactGatePath('templates/docs/prd.md')` → `false`;
     `isArtifactGatePath('docs/prd/foo.txt')` → `false`.
  2. `inferArtifactTypeFromPath` against real tmpdir files (via `fs.mkdtempSync`):
     a `docs/specs/prd/foo.md` with no frontmatter infers `'prd'`; a file with
     `cx_doc_type: adr` frontmatter outside `docs/` entirely still infers `'adr'`
     (frontmatter wins over / is independent of directory heuristics); a
     `docs/decisions/adr/bar.md` with no frontmatter infers `'adr'`.
  3. File header comment only (CLAUDE.md comment convention); no inline
     trailing comments.
  4. `node --test tests/artifact-type-from-path.test.mjs` passes with 0 failures.
  5. Only that one file touched; `lib/artifact-type-from-path.mjs` untouched.

## Sub-task B — `lib/model-tiers.mjs`

- **File to add**: `tests/model-tiers.test.mjs`
- **Change**: unit tests for `MODEL_TIERS`, `MODEL_TIER_SET`, `isModelTier(value)`.
- **Acceptance criteria**:
  1. `MODEL_TIERS` deep-equals `['reasoning', 'standard', 'fast']` in that
     exact order, and `Object.isFrozen(MODEL_TIERS)` is true.
  2. `MODEL_TIER_SET` is a `Set` of size 3 containing exactly those values,
     and `Object.isFrozen(MODEL_TIER_SET)` is true.
  3. `isModelTier('reasoning' | 'standard' | 'fast')` → `true` for each;
     `isModelTier('bogus' | undefined | '')` → `false` for each.
  4. File header comment only; no inline trailing comments.
  5. `node --test tests/model-tiers.test.mjs` passes with 0 failures.
  6. Only that one file touched; `lib/model-tiers.mjs` untouched.

## Sub-task C — `lib/vscode-paths.mjs`

- **File to add**: `tests/vscode-paths.test.mjs`
- **Change**: unit test for `getVSCodeUserDirs(homeDir = os.homedir())`.
- **Acceptance criteria**:
  1. Since `os.platform()` is read internally (not injectable), the test
     branches on the real `os.platform()` at run time and asserts the paths
     that platform's source branch actually produces — portable across CI
     platforms, no hardcoded single-OS assumption.
  2. `getVSCodeUserDirs('/fake/home')` returns an array of length 2 whose
     entries both contain `'Code'`, one of which also contains `'Insiders'`.
  3. File header comment only; no inline trailing comments.
  4. `node --test tests/vscode-paths.test.mjs` passes with 0 failures.
  5. Only that one file touched; `lib/vscode-paths.mjs` untouched.

## Why these three are genuinely independent

- None of the three source modules imports any of the other two (confirmed
  by reading all three files in full).
- The graph's dependents sets for the three `file:` nodes share zero overlap
  (see `graph-independence-check.sh` and the synthesis report for the actual
  `construct graph query` output).
- Each sub-task only *adds* a brand-new test file; it never edits an existing
  file, so there is no line-level overlap for git to merge — the only way
  these three changes could conflict is if two workers picked the same new
  filename, which the spec avoids by construction.
