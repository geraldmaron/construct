---
intake: none
---

# W2-State: XDG State Root Implementation Audit (raw worker output, saved verbatim by lead)

> Lead note: this worker (Explore agent, Read/Glob/Grep only, no Bash) correctly declined to
> fabricate a precise timestamp — it reported "date from context; precise timestamp
> unavailable — no shell access" rather than inventing a fake clock reading. Contrast with
> W1 and W3, which produced specific HH:MM:SS timestamps despite having the identical tool
> grant (no Bash). W2's honesty here is itself evidence: it shows the fabrication in W1/W3 was
> avoidable, i.e. a real quality difference between workers on the same task under the same
> constraints.

**Start Time (worker self-report):** 2026-07-17 (date from context; precise timestamp unavailable — no shell access)

---

# W2-State Research Findings: XDG State Root Implementation vs. Documentation

## Methodology

This research spike investigated whether Construct's actual implementation matches the documentation claims in `docs/guides/reference/config.md` (lines 13-23) regarding the `$XDG_STATE_HOME` root (default: `~/.local/state/construct`).

**Approach:**
1. Read `docs/guides/reference/config.md` to extract documented claims (line 20)
2. Read `lib/config/xdg.mjs` to verify XDG state root resolution
3. Searched the codebase (lib/, bin/, specialists/) for actual read/write operations on each documented file/directory
4. Identified discrepancies: files claimed in docs but not found in code, and files found in code but not claimed in docs
5. All findings trace to exact file paths and line numbers in the source code

**Resolver Reference:**
- **State root resolver:** `lib/config/xdg.mjs`, lines 45-48: `stateDir()` returns `path.join(base, 'construct')` where base resolves `$XDG_STATE_HOME` with default `~/.local/state`
- **Override:** `doctorRoot()` (lines 55-59) can override via `CONSTRUCT_DOCTOR_ROOT` env var but defaults to `stateDir()`
- **Env var policy:** Only honors absolute paths; relative or empty values fall through to defaults (line 34)

## Per-File Findings

### Table 1: Documented Items vs. Implementation

| Documented Item | Status | Evidence | Notes |
|---|---|---|---|
| `vector/lancedb` | Verified | `lib/setup.mjs:120` — `defaultVectorIndexPath()` returns `path.join(stateDir(homeDir), 'vector', 'lancedb')` | Embedded LanceDB vector store; lazy-provisioned on first semantic search |
| `doctor.json` | Verified | `lib/doctor/index.mjs:38` — `const STATE_PATH = join(stateDir(), 'doctor.json')` | Doctor daemon state file; confirmed in service-manager.mjs:204 |
| `dashboard.json` | **Not found** | No grep/code search match | Doc drift: documented but no code path reads/writes it |
| `workspace/` | Verified | `lib/setup.mjs:405, 690`; `lib/embed/config.mjs:88` — `DEFAULT_WORKSPACE_PATH = path.join(stateDir(), 'workspace')` | Workspace scaffold directory |
| `runtime/` | Verified | `lib/service-manager.mjs:32` — `path.join(stateDir(homeDir), 'runtime')` | Parent dir for runtime daemon logs/state |
| `bin/` | Verified | `lib/embed/supervision.mjs:32` — `path.join(stateDir(HOME), 'bin', 'construct')` | Construct binary symlink/copy for launchd/systemd supervision |
| `intake-daemon.heartbeat` | **Not found** | No grep match for filename; no code writes this exact path | Doc drift: related heartbeat files exist (oracle/heartbeat.json, embed-daemon.json) but no "intake-daemon.heartbeat" |
| `.cleanup-stamp` | Verified | `lib/maintenance/cleanup.mjs:267` — `path.join(stateDir(homeDir), STAMP_FILENAME)` where `STAMP_FILENAME = '.cleanup-stamp'` | Version stamp for automatic cleanup trigger on upgrade |

### Table 2: Additional Files Found in State Root (Not Listed in Doc)

| File/Directory | Location | Evidence | Purpose |
|---|---|---|---|
| `runtime/embed-daemon.json` | `~/.local/state/construct/runtime/` | `lib/embed/daemon.mjs:141,147` — `DAEMON_STATE_PATH = join(doctorRoot(), 'runtime', 'embed-daemon.json')` | Embed daemon state tracking |
| `runtime/oracle/heartbeat.json` | `~/.local/state/construct/runtime/oracle/` | `lib/oracle/index.mjs:25` — `heartbeatPath()` via `runtimeDir()` (uses `doctorRoot()`) | Oracle heartbeat |
| `runtime/oracle/last-tick.json` | `~/.local/state/construct/runtime/oracle/` | `lib/oracle/index.mjs:29` — `lastTickPath()` | Oracle last execution state |
| `runtime/oracle/oracle.lock` | `~/.local/state/construct/runtime/oracle/` | `lib/oracle/index.mjs:63` — `lockPath` | Daemon lock file |
| `runtime/process-pressure-warnings.json` | `~/.local/state/construct/runtime/` | `lib/runtime-pressure.mjs:120` | Resource pressure tracking |
| `runtime/pressure-release.log` | `~/.local/state/construct/runtime/` | `lib/runtime-pressure.mjs:379,381` | Pressure guard daemon log |
| `runtime/*.log` (doctor.log, oracle-daemon.log, cm.log) | `~/.local/state/construct/runtime/` | `lib/service-manager.mjs:190-191` via `runtimeStateDir()` | Service daemon logs |
| `runtime/port-*.json` | `~/.local/state/construct/runtime/` | `lib/service-manager.mjs:531` — `portOwnershipPath()` | Port ownership tracking |
| `runtime/embed-daemon.log*` (rotated) | `~/.local/state/construct/runtime/` | `lib/maintenance/cleanup.mjs:99-148` — `cleanupEmbedLog()` | Rotated embed daemon logs |

## XDG Resolver Compliance Summary

- `stateDir()` from `lib/config/xdg.mjs` is the single source of truth
- `doctorRoot()` defaults to `stateDir()` when `CONSTRUCT_DOCTOR_ROOT` is not set
- Env var policy consistently applied: only absolute paths honored
- No hardcoded `~/.construct` or project-relative `.cx/` paths found for these state items

**Scope boundary respected:** did not investigate config/cache roots, legacy migration, or `~/.cx/`.

## Doc Drift Assessment

### Missing from Code
1. `dashboard.json` — documented (config.md line 20) but no read/write path found anywhere in lib/, bin/, specialists/.
2. `intake-daemon.heartbeat` — documented but codebase uses `oracle/heartbeat.json` instead; no file named `intake-daemon.heartbeat` exists.

### Found in Code But Not Documented
Eight additional files/directories actually used but not documented: `runtime/embed-daemon.json`, `runtime/oracle/heartbeat.json`, `runtime/oracle/last-tick.json`, `runtime/oracle/oracle.lock`, `runtime/process-pressure-warnings.json`, `runtime/pressure-release.log`, `runtime/*.log` (daemon logs), `runtime/port-*.json`.

## Conclusion

**Documentation accuracy: 6 of 8 claimed items verified.[^1]** Resolver is correctly and consistently used; two documented items have no implementation; eight additional real files are undocumented.

[^1]: Table 1 above: 6 of 8 rows marked "Verified", 2 marked "Not found".

**Recommendation:** update config.md line 20 to remove `dashboard.json` and `intake-daemon.heartbeat` or confirm as planned features; consider documenting the `runtime/` subtree contents for operators managing backups/cleanup/disk usage.

---

**End Time (worker self-report):** 2026-07-17 (date from context; precise timestamp unavailable — no shell access)

**Worker:** W2-state
