# W4-Legacy: Clean-Break / No-Migration Claim Audit (raw worker output, saved verbatim by lead)

> Lead note: same tool grant as the others (Explore: Read/Glob/Grep, no Bash). This worker
> explicitly stated it could not capture a timestamp ("Unable to capture via bash in this
> environment") rather than fabricating one — same honest behavior as W2, contrasting with
> W1 and (partially) W3.

**Start Time (worker self-report):** Unable to capture via bash in this environment — recorded as investigation commenced

---

# Worker W4-Legacy Research Report

**Research Question**: Is the "clean break" claim in docs/guides/reference/config.md line 23 actually true in the current codebase?

## Methodology

1. Read target document: `docs/guides/reference/config.md` (lines 1-343)
2. Searched codebase for references to `~/.construct` in legacy/user-home contexts
3. Examined migration code: `lib/config/legacy-config-migration.mjs`
4. Traced migration function calls in `lib/setup.mjs`
5. Reviewed doctor checks in `lib/doctor/watchers/credential-parity.mjs`
6. Investigated intake policy resolution in `lib/config/intake-policy.mjs`
7. Analyzed `~/.cx/` usage patterns and relationship to XDG paths

## Key Findings

### 1. The Doc Claim (Line 23)

Exact wording from docs/guides/reference/config.md:23:
> **Upgrade — clean break.** There is no read or migration of a legacy `~/.construct/*`
> tree. After upgrading, run `construct install --scope=user` once to repopulate the
> user-scope files at the XDG paths. `construct doctor` flags a missing user config until you do.

### 2. CONTRADICTING EVIDENCE: Legacy Reads and Migrations DO Exist

**File: `lib/config/legacy-config-migration.mjs` (lines 1-125)**

Explicitly provides two export functions that READ from the legacy `~/.construct/config.env`:

- `migrateLegacyModelConfig()` (lines 76-96): line 23-25 defines `legacyConfigPath()` returning `~/.construct/config.env`; line 81 checks `if (legacyPath === xdgPath || !fs.existsSync(legacyPath)) return result;`; line 83 reads the legacy file `const legacyEnv = parseEnvFile(legacyPath);`; migrates `CX_MODEL_*` / `CONSTRUCT_MODEL_*` keys (line 88, regex `/^(?:CX|CONSTRUCT)_MODEL_/`).
- `migrateLegacyCredentialConfig()` (lines 103-125): line 108 checks legacy path existence; line 110 reads the legacy file; line 115 migrates `CONSTRUCT_OP_ENV_FILE` and credential env vars; line 117 backfills credentials from the referenced 1Password env file.

**File: `lib/setup.mjs` (lines 472-483)**

These migration functions are actively called during setup: line 475 `const modelMigration = migrateLegacyModelConfig({ homeDir });`; lines 476-478 log successful migrations; line 480 `const credentialMigration = migrateLegacyCredentialConfig({ homeDir });`; lines 481-482 log credential migrations.

**File: `lib/doctor/watchers/credential-parity.mjs` (lines 68-77)**

Doctor actively reads the legacy config to flag mismatches: line 70 `const legacyEnv = parseEnvFile(path.join(homeDir, '.construct', 'config.env'));`; line 71 `if (legacyEnv.CONSTRUCT_OP_ENV_FILE && !xdgEnv.CONSTRUCT_OP_ENV_FILE) {`; line 75 flags a violation: `'CONSTRUCT_OP_ENV_FILE is still in ~/.construct/config.env — run construct install --footprint=user to migrate to XDG config'`.

### 3. Doctor Behavior Claim (Line 23) — PARTIALLY VERIFIED

The doc claims: "`construct doctor` flags a missing user config until you do." Evidence: `lib/doctor/watchers/credential-parity.mjs` (lines 68-77) reads both XDG config and legacy config and flags a violation (severity: 'advisory') only when `CONSTRUCT_OP_ENV_FILE` exists solely in the legacy location, recommending `construct install --footprint=user`. Note: this is a narrower check (one specific env var) than the doc's "flags a missing user config" wording suggests.

### 4. The ~/.cx/ Relationship (Line 82-83) — Confirmed separate, currently active

From docs/guides/reference/config.md:82-83, `~/.cx/` is documented as a separate base under `$HOME` (not one of the three XDG roots), with its own override `CX_DATA_DIR` (line 83). Used throughout the codebase (55+ files reference `cxDir()`). Actively used for project-local config/state, not legacy.

**Note on line 165 claim**: doc line 165 states "A legacy `.cx/intake-config.json` is read as a warned fallback for `maxDepth` and `additionalDirs` only." Status: **UNVERIFIED — code not found.** No code found in `lib/config/intake-policy.mjs` or elsewhere that reads a legacy `.cx/intake-config.json`. Intake policy resolution (lines 59-93 of `lib/config/intake-policy.mjs`) reads only project config (`construct.config.json`), environment variables (`CX_INBOX_DIRS`, `CX_INTAKE_MAX_DEPTH`), and defaults. May be outdated/aspirational documentation.

## Factual Contradiction Summary

| Claim | Location | Reality | Evidence |
|---|---|---|---|
| "There is no read or migration of a legacy ~/.construct/* tree" | config.md:23 | **FALSE** | `lib/config/legacy-config-migration.mjs` contains two explicit read+migrate functions; actively called in `lib/setup.mjs:475,480` |
| "construct doctor flags a missing user config until you do" | config.md:23 | **PARTIALLY TRUE** | `lib/doctor/watchers/credential-parity.mjs:75` flags only when `CONSTRUCT_OP_ENV_FILE` is in the legacy location; narrower than the doc implies |
| "A legacy .cx/intake-config.json is read as a warned fallback" | config.md:165 | **UNVERIFIED** | No code found; `lib/config/intake-policy.mjs` never reads this file |

## Conclusion

The "clean break" claim is **not accurate**. The codebase does read and migrate data from the legacy `~/.construct/config.env` tree during `construct install --footprint=user` setup, preserving model tier overrides and credential references before/alongside XDG repopulation.

Suggested correction: "During upgrade, `construct install --footprint=user` automatically migrates eligible settings (model tier overrides, `CONSTRUCT_OP_ENV_FILE` reference) from `~/.construct/config.env` to XDG paths before cleanup, so no manual copy is required."

## Cited Files (absolute paths)

1. `/Users/geralddagher/Developer/Projects/construct/.claude/worktrees/workspace-control-plane/docs/guides/reference/config.md` (lines 23, 82-83, 165)
2. `/Users/geralddagher/Developer/Projects/construct/.claude/worktrees/workspace-control-plane/lib/config/legacy-config-migration.mjs` (lines 3-125, particularly 23-25, 76-96, 103-125)
3. `/Users/geralddagher/Developer/Projects/construct/.claude/worktrees/workspace-control-plane/lib/setup.mjs` (lines 472-483)
4. `/Users/geralddagher/Developer/Projects/construct/.claude/worktrees/workspace-control-plane/lib/doctor/watchers/credential-parity.mjs` (lines 68-77)
5. `/Users/geralddagher/Developer/Projects/construct/.claude/worktrees/workspace-control-plane/lib/config/intake-policy.mjs` (lines 59-93)
6. `/Users/geralddagher/Developer/Projects/construct/.claude/worktrees/workspace-control-plane/lib/paths.mjs` (lines 1-34)

---

**End Time (worker self-report):** Unable to capture via bash in this environment — recorded as investigation completed

**Worker:** W4-legacy
