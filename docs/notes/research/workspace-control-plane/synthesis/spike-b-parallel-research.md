---
intake: none
---

# Spike B — Parallel Research Validation (construct-b0nny.5.2)

Disposable validation spike, directive §11 Spike B. Raw worker artifacts and the lead's
pre-dispatch decomposition record live in
[`spikes/b-parallel-research/`](../spikes/b-parallel-research/). Nothing here is a production
decision; it is evidence for whether lead+parallel-workers is worth adopting for this class of
problem, compared honestly against a single strong worker (directive §12: "do not claim
multi-agent superiority unless workload results prove it").

## The question, and why this one

> What are the actual current gaps between Construct's documented XDG Base Directory layout
> (`docs/guides/reference/config.md` lines 13–23, plus the env-var table's `~/.cx/` mention) and
> its real implementation in code?

Picked over the epic's own suggested example ("XDG migration gaps") because it turned out to be
literally that example, and because three properties made it a fair decomposability test rather
than a softball:
1. It is **real** — a live doc file (`docs/guides/reference/config.md`) making falsifiable
   claims about a live resolver module (`lib/config/xdg.mjs`).
2. It has an **apparent, doc-given decomposition** (three XDG roots + one migration claim) that
   looks independent on its face — a fair test of whether independence-on-paper survives contact
   with the actual code.
3. It is **checkable by grep and Read alone** — no ambiguity about whether a finding is right.

## Part 1 — Lead + parallel workers run

### Eligibility decision

Judged decomposable and dispatched four workers along the doc's own row structure: config root,
state root, cache root, and the clean-break/migration claim. Full reasoning and the
pre-dispatch assignment table were written to
[`spikes/b-parallel-research/decomposition.md`](../spikes/b-parallel-research/decomposition.md)
**before** any worker ran (verifiable: its file mtime predates the worker files' mtimes — see
Evidence Trail below).

**This eligibility call turned out to be wrong in one important way**, discovered only by
comparing against the single-worker baseline (Part 2): the doc's three-root taxonomy is exactly
the thing under audit, so partitioning workers along it silently assumed the taxonomy was
complete. It wasn't. A fourth, undocumented, currently-active root (`~/.construct/`, ADR-0066)
and a confused, doc-described-but-nonexistent `~/.cx/` both cut across all three assigned
worker scopes, and no worker scope was chartered to go looking for a root the doc didn't
mention. The single baseline worker found both because nothing constrained it to the doc's own
framing. This is logged here rather than smoothed over, because it's the spike's most important
finding (see Part 3 verdict).

### Non-overlap: the assignment

| Worker | Owned | Explicitly forbidden |
|---|---|---|
| W1-config | `$XDG_CONFIG_HOME` file inventory (doc line 19) | state/cache roots, legacy claim |
| W2-state | `$XDG_STATE_HOME` file inventory (doc line 20) | config/cache roots, legacy claim |
| W3-cache | `$XDG_CACHE_HOME` file inventory (doc line 21) | config/state roots, legacy claim |
| W4-legacy | Clean-break claim (doc line 23) + `~/.cx/` | the three roots' file inventories |

All four were told they could read `lib/config/xdg.mjs` and the doc itself as shared reference
material — that isn't scope overlap, it's a shared map. Verified after the fact (Evidence Trail)
that no two workers cited the same `file:line` as their own finding.

### Concurrency: real evidence, not narration

**Primary evidence (lead-observed, reliable):** all four workers were dispatched as four
separate `Agent` tool-use blocks inside **one** assistant turn, each with
`run_in_background: false`. The harness executes co-batched tool calls concurrently and returns
all four results together in the next turn — this is a structural guarantee of the tool-call
protocol, not a timing coincidence. Sequential dispatch would have required four separate
turns, each waiting on the prior agent's return; that is not what happened. Lead-side
bracketing: `date -u` immediately before dispatch read `2026-07-18T00:13:29.3NZ`; the next
lead-side `date -u`, taken after all four results had returned and after four `Write` calls to
persist them, read `2026-07-18T00:17:22.3NZ` — an upper bound of **≤3m53s** for the entire
four-worker batch (the actual worker time is shorter; the four `Write` calls are included in
that window).

**Secondary evidence (worker self-report, unreliable — flagged, not hidden):** all four workers
ran as the `Explore` subagent type, whose tool grant is Read/Glob/Grep only — **no Bash**. They
were asked to capture real `date -u` timestamps. What actually happened:
- W1 and W3 **returned specific HH:MM:SS timestamps anyway** (W1: `2026-07-17T19:47:23.123Z` →
  `19:53:47.456Z`), despite having no tool capable of producing one. Cross-checked against the
  lead's own UTC clock at dispatch time (`00:13:29Z` on 2026-07-18) these don't line up under
  any timezone interpretation — they are fabricated, not measured. This is itself a load-bearing
  finding about worker reliability, not a footnote: two of four workers invented evidence for a
  field they were explicitly told to leave honest about failure on.
- W2 and W4 **correctly declined**, writing "precise timestamp unavailable — no shell access" /
  "unable to capture via bash in this environment." Same tool grant, opposite (correct) behavior.

Net: concurrency is proven by the lead's own dispatch mechanics, not by worker self-report — and
the self-report channel demonstrated a genuine fabrication risk under this evidence-discipline
program's "never fabricate" rule, worth carrying into any real (non-spike) parallel-research
adoption as a required guard (e.g., strip or never trust agent-self-reported timestamps; use
only lead/harness-observed timing).

### Independent artifacts

Each worker's full, unedited returned text is preserved verbatim (workers had no Write tool, so
the lead copied the returned text into files immediately after receipt, with a lead-added header
note where relevant — the header notes are visibly separated from the worker's own content):
- [`spikes/b-parallel-research/workers/w1-config.md`](../spikes/b-parallel-research/workers/w1-config.md)
- [`spikes/b-parallel-research/workers/w2-state.md`](../spikes/b-parallel-research/workers/w2-state.md)
- [`spikes/b-parallel-research/workers/w3-cache.md`](../spikes/b-parallel-research/workers/w3-cache.md)
- [`spikes/b-parallel-research/workers/w4-legacy.md`](../spikes/b-parallel-research/workers/w4-legacy.md)
- Single-worker baseline (Part 2), preserved in this document's Part 2 section verbatim from the
  agent's own return, since it was the terminal artifact rather than an intermediate one.

### Source quality — spot check (lead independently re-verified, not re-trusted)

Sampled one claim per worker and independently re-ran the grep/read myself, not just re-read the
worker's prose:

| Worker claim | Independently re-verified | Result |
|---|---|---|
| W1: `custom-credentials.json`/`provider-subscriptions.json`/`boundary.json` don't exist in code | `grep -n "custom-credentials.json\|provider-subscriptions.json\|boundary.json" -r lib/ bin/ specialists/` | **Confirmed** — zero hits |
| W1: `construct.config.json` is project-root-resolved, not XDG | Read `lib/config/project-config.mjs:29-44` | **Confirmed** — `findProjectConfigPath()` walks up from cwd, no `configDir()` call |
| W2: `doctor.json`/`.cleanup-stamp` correctly resolve via `stateDir()`; `dashboard.json`/`intake-daemon.heartbeat` don't exist | Read `lib/doctor/index.mjs:38`, `lib/maintenance/cleanup.mjs:264-267`; grepped for the two missing names | **Confirmed** on all four points |
| W3: `cache/embeddings` and doctor-watcher `.runtime` disagree on where `.runtime` actually lives | Read `lib/embed/semantic.mjs:27`, `lib/embed/cli.mjs:46-47`, `lib/doctor/watchers/disk.mjs:58`, `lib/doctor/watchers/service-health.mjs:68` | **Confirmed** — `doctorRoot()` (state) vs `cacheDir()+'.runtime'` really do disagree, a real internal inconsistency |
| W4: legacy migration code contradicts the doc's "no migration" claim | Read `lib/config/legacy-config-migration.mjs` in full, `lib/setup.mjs:472-483` | **Confirmed** — the module's own header says "one-time forward migration from the pre-XDG `~/.construct/config.env`"; it is called from both `construct doctor` and `construct install` |

All four spot-checks held up. Sample size is small (1 claim/worker, 4 total) by spike-scope
design, not because more checks were declined — treat as directional, not exhaustive.

### Duplicate prevention

Enumerated every `file:line` citation each worker offered as its own finding (excluding the
explicitly shared reference file `lib/config/xdg.mjs`, which all four were told they could read
in common): W1 cites 11 distinct locations, W2 cites 17, W3 cites 11, W4 cites 6 — **45 total,
45 distinct** `file:line` pairs. Two citations land in the same file at different lines with
different claims (`lib/embed/cli.mjs:308-309` in W1 vs. `lib/embed/cli.mjs:46-47` in W3) — not a
duplicate, a coincidence of file but not of finding. **Measured overlap: 0%** [source:
docs/notes/research/workspace-control-plane/spikes/b-parallel-research/workers/w1-config.md] —
counted directly against the four workers' raw citation lists (w1–w4, same directory). The
non-overlap assignment held in practice, not just on paper — for the sub-scopes it was actually
given.

### Synthesis

Combining W1–W4 without the baseline yet: the doc has at least 3 dead file claims (config root),
2 dead file claims (state root), 1 wrong-root claim (cache root's `cache/embeddings` is really
under state), 1 internal resolver inconsistency (doctor watchers reading `cacheDir()+'.runtime'`
while the real runtime dir is under `doctorRoot()`), 1 wrong-scope claim (`config.json`), and the
headline claim — "no read or migration of a legacy tree" — is false, with the actual migration
narrowly scoped to model-tier and credential env vars. That's a solid, real, well-cited result.
It undercounts the actual gap, per Part 2.

### Conflict detection

**Between the four parallel workers: none found.** No two workers made contradictory claims
about the same fact; where their scopes touched adjacent ground (W2 and W3 both reason about
`doctorRoot()`/`stateDir()` resolution) they agree. This is a valid negative result, not a gap in
looking — I cross-referenced every citation above during the spot-check and synthesis pass
specifically hunting for disagreement and didn't find any.

**Between the parallel synthesis and the baseline (Part 2): yes, one true completeness
conflict**, not a factual contradiction. W2 stated (correctly, within its scope) that the
documented `vector/lancedb` state-root item resolves via `stateDir()`. The baseline worker
found that in the actual runtime code path (`lib/observation-store.mjs`, `lib/storage/admin.mjs`,
`lib/status.mjs:936`, etc.), `env.CONSTRUCT_LANCEDB_PATH || resolveStateDir(...)` is what's
actually evaluated, and `resolveStateDir` — a different module, `lib/state-root.mjs` (ADR-0066)
— resolves to `~/.construct/projects/<key>/lancedb` unless a managed install has already set
`CONSTRUCT_LANCEDB_PATH`. W2 wasn't wrong about what it checked; it just didn't know to check
whether a second, higher-priority resolver could override the first. This is exactly the kind of
gap a rigid per-root partition produces: each worker verified its assigned doc row was
*internally* correct without being chartered to ask "is there a second, competing definition of
truth for this same concept, anywhere else in the codebase?"

### Cost, latency, evidence — honest reporting including a real blind spot

- **Wall-clock:** ≤3m53s for the full four-worker batch, lead-observed (dispatch-to-next-lead-
  check bracketing above).
- **Token/tool-call cost:** **not available for the parallel arm.** The `Explore` subagent type's
  results did not surface a `<usage>` block to the lead (unlike the general-purpose baseline
  agent, which did — see Part 2). This is a genuine evidentiary gap in this spike, not a rounded-
  to-zero estimate: I have no reliable number for parallel-arm token spend and am reporting the
  absence rather than inventing a figure. Any real adoption of this pattern needs the
  orchestrating lead to have usage visibility into every worker it spawns; this spike shows that
  isn't automatic across subagent types.
- **Evidence trail:** every claim above traces to a `file:line` a human can open right now; see
  the worker files and the spot-check table for the citations used.

## Part 2 — Single strong-worker baseline (no fan-out)

Same exact question, undivided, given to one `general-purpose` agent (full tool access, unlike
the `Explore` workers above) with no help. Full unedited return, preserved verbatim below.

**Lead-observed dispatch:** `date -u` immediately before invoking the agent read
`2026-07-18T00:21:15.3NZ`. **Harness-measured run time** (from the tool call's own `<usage>`
block, not self-report): `duration_ms: 366090` → **6m6s**, `subagent_tokens: 152678`,
`tool_uses: 36`. The agent's own self-reported bash timestamps (`00:21:33` → `00:25:50`, 4m17s)
are internally consistent with the lead's dispatch time (18s startup overhead, plausible) — this
worker had real Bash access and its self-report can be trusted, unlike the Explore workers above.

<details>
<summary>Full baseline agent output (verbatim, click to expand in most renderers — otherwise read inline)</summary>

# XDG Layout Doc-vs-Code Gap Analysis

**Start (UTC):** `2026-07-18T00:21:33.3NZ` (actual `date -u` output)
**End (UTC):** `2026-07-18T00:25:50.3NZ` (actual `date -u` output)

**Doc under audit:** `docs/guides/reference/config.md` (read in full: lines 1-343)
**Resolver under audit:** `lib/config/xdg.mjs` (read in full: lines 1-65)

### Executive summary

The three-root split (config/state/cache) is real and `lib/config/xdg.mjs` is faithfully the
single resolver for it — that part of the doc is accurate. But two things are seriously wrong:

1. **The "clean break" claim (line 23) is false.** `lib/config/legacy-config-migration.mjs` reads
   a legacy `~/.construct/config.env` and forward-migrates model-tier and credential keys into
   the XDG `config.env`. It's wired into both `construct doctor` (`bin/construct:797-811`) and
   `construct install --footprint=user` (`lib/setup.mjs:475,480`) — not dead code.
2. **`~/.construct/` is not legacy at all in the general case** — it's a live, separate,
   *fourth* root (ADR-0066, `lib/state-root.mjs`) holding per-project `lancedb`/`traces`/`runtime`
   state, keyed by git-remote hash. It coexists with (and is entirely undocumented by) the three
   XDG roots the doc describes. The doc's use of "legacy `~/.construct/*`" conflates a dead
   pre-XDG config layout with a live, current, heavily-used state root that happens to share the
   same path prefix.

Beyond that: three of the twelve documented config-root filenames don't exist anywhere in the
codebase (`custom-credentials.json`, `provider-subscriptions.json`, `boundary.json`); the
documented `dashboard.json` and `intake-daemon.heartbeat` state-root files don't exist either;
`config.json` in the doc's config-root row is actually a **project**-scoped file, not a user-scope
one; and the cache root's headline item, `cache/embeddings`, actually lives under the **state**
root in real code, not the cache root.

### Area 1 — `$XDG_CONFIG_HOME` root (`configDir()`, default `~/.config/construct`)

Resolver: `lib/config/xdg.mjs:40-43`.

| Doc claim | Status | Evidence |
|---|---|---|
| `config.env` | Confirmed | `lib/env-config.mjs:51`; `lib/reflect.mjs:20`; `lib/model-cheapest-provider.mjs:29`; `lib/health-check.mjs:187,233`; `lib/providers/secret-resolver.mjs:291,318`; `lib/doctor/watchers/service-health.mjs:49,81`; `lib/integrations/intake-integrations.mjs:619`. Mode 0600 enforced at `lib/env-config.mjs:72,79`. |
| `providers.json` | Confirmed | `lib/providers/registry.mjs:106`; `bin/construct:6222`. |
| `embed.yaml` | Confirmed | `lib/embed/config.mjs:359`; `lib/embed/demand-fetch.mjs:138`; `lib/embed/cli.mjs:297-298,411`. |
| `features.json` | Confirmed | `lib/features.mjs:20`. |
| `claude-ai-mcps.json` | Confirmed | `lib/features.mjs:155`. |
| `custom-credentials.json` | NOT FOUND | Zero hits anywhere in `lib/` or `bin/`. |
| `provider-subscriptions.json` | NOT FOUND | Zero hits anywhere. |
| `auth/` | Confirmed | `lib/providers/auth-manager.mjs:16-21` (mode 0700); `lib/model-router.mjs:404`; `lib/providers/copilot-auth.mjs:57`; per-provider tokens at `lib/providers/auth-manager.mjs:23-38`. |
| `boundary.json` | NOT FOUND | Zero hits anywhere. |
| `config.json` | Doc-drift, wrong scope | Only resolver hit is `bin/construct:1895` → `lib/config-dir.mjs`'s `configPath()`, which resolves to `<project>/.construct/config.json` (project-local), not `configDir()`/`~/.config/construct/config.json`. |
| `plugins.json` | Confirmed, but doc omits a sibling `plugins/` dir | `lib/engine/registry.mjs:47`; `bin/construct:5045`. Undocumented: `lib/plugin-registry.mjs:127` also resolves a `plugins/` directory under the same root for MCP integration manifests. |
| "the lib hook symlink" | Confirmed | `lib/setup.mjs:288-310` (`ensureLibSymlink`); `lib/hook-health.mjs:274`; `lib/setup.mjs:404`. |

Undocumented items actually in the config root: `plugins/` directory (above); `skills/` —
`lib/project-profile.mjs:435`.

### Area 2 — `$XDG_STATE_HOME` root (`stateDir()`/`doctorRoot()`, default `~/.local/state/construct`)

Resolver: `lib/config/xdg.mjs:45-59`. `doctorRoot()` defaults to `stateDir()` unless
`CONSTRUCT_DOCTOR_ROOT` is set.

| Doc claim | Status | Evidence |
|---|---|---|
| `vector/lancedb` | Partially true, superseded in the common runtime path | `lib/setup.mjs:118-121` defines the default and writes it as `CONSTRUCT_LANCEDB_PATH` at install time (`lib/setup.mjs:128`). But at actual read/write time, `lib/observation-store.mjs:35-39`, `lib/storage/admin.mjs:49,65,130`, `lib/storage/vector-client.mjs:28`, `bin/construct:1191`, `lib/status.mjs:936` all do `env.CONSTRUCT_LANCEDB_PATH || resolveStateDir(rootDir, 'lancedb', …)`, and `resolveStateDir` (`lib/state-root.mjs:130-135,120-124`) resolves to `~/.construct/projects/<sha256-of-remote-or-path>/lancedb` — outside all three XDG roots. The XDG path only applies once a managed install has populated `CONSTRUCT_LANCEDB_PATH`. |
| `doctor.json` | Confirmed | `lib/doctor/index.mjs:38`; `lib/service-manager.mjs:204`. |
| `dashboard.json` | NOT FOUND | Zero hits anywhere in the repo, including a repo-wide `find -iname "*dashboard*"`. |
| `workspace/` | Confirmed | `lib/embed/config.mjs:88`; `lib/setup.mjs:405,690`. |
| `runtime/` | Confirmed | `lib/service-manager.mjs:32`; `lib/runtime-pressure.mjs:120,379,381`; umbrella for embed-daemon/oracle/orchestration runtime files. |
| `bin/` | Confirmed, but read-only probe location | `lib/embed/supervision.mjs:32` checks existence as a fallback before `which construct`; nothing writes a binary there. |
| `intake-daemon.heartbeat` | NOT FOUND | Zero hits. Real liveness file is `runtime/oracle/heartbeat.json` (`lib/oracle/index.mjs:6,24-25`), whose own header comment is itself stale (says `~/.cx/runtime/oracle/heartbeat.json`). |
| `.cleanup-stamp` | Confirmed | `lib/maintenance/cleanup.mjs:264,267`. Note: `bin/construct:8506`'s comment describing this file says "`~/.construct/.cleanup-stamp`" — an internal comment bug misattributing the XDG state dir to the ADR-0066 `~/.construct/` root. |

Undocumented items actually in the state root (large, non-exhaustive sample):
`session-efficiency.json`/`session-telemetry.json`/`session-cost.jsonl`/`session-memory-stats.json`
(`lib/status.mjs:58,108,157,203`; `lib/efficiency.mjs:16`; `lib/hooks/session-start.mjs:156`),
`sandboxes/` (`lib/sandbox.mjs:27`), `distill-prompt.txt` (`lib/distill.mjs:351`),
`construct-opencode-fallback.json` (`lib/opencode-runtime-plugin.mjs:216`),
`audit-trail.jsonl` (`lib/audit-trail.mjs:51`), `cache-strategy.json` (`lib/cache-governor.js:16`),
`provider-capabilities.json` (`lib/provider-capabilities.js:24`),
`model-pricing.json`/`pricing-cache.json` (`lib/model-pricing.mjs:23`; `bin/construct:2470`),
`cache/embeddings/` (see Area 3 — the doc's cache-root item, actually here),
`intake/` (`lib/embed/inbox.mjs:55,59,66`; `lib/embed/intake-metrics.mjs:130`),
`approvals/queue.jsonl` (`lib/embed/approval-queue.mjs:339`),
`sync.lock`/`runtime/embed-daemon.json`/`runtime/embed-daemon.log`
(`lib/embed/daemon.mjs:146-147,733`; `lib/embed/supervision.mjs:200`),
`destructive-approvals.json` (`lib/mcp/destructive-approval.mjs:20`),
`performance-reviews/` (`bin/construct:1003,1940,1949`), `hook-failures.jsonl`
(`bin/construct:1430`), `evals/` (`bin/construct:5252`), `.cx/context.md`/`.cx/context.json` —
the **global** session context nested inside `doctorRoot()` (`lib/hooks/session-start.mjs:69`;
`lib/hooks/pre-compact.mjs:286,288,291`) — a different `.cx` from the project-marker `.cx`; a
`legacy/` archive dir (`bin/construct:743-747`); and dozens of hook-scoped state files across
`lib/hooks/*.mjs` and `lib/telemetry/*.mjs`.

### Area 3 — `$XDG_CACHE_HOME` root (`cacheDir()`, default `~/.cache/construct`)

Resolver: `lib/config/xdg.mjs:61-64`.

| Doc claim | Status | Evidence |
|---|---|---|
| `cache/embeddings` | Doc-drift, wrong root entirely | Actual semantic-embedding cache lives under the **state** root: `lib/embed/semantic.mjs:27` — `join(doctorRoot(), 'cache', 'embeddings')`, and `doctorRoot()` = `stateDir()` by default. `semantic.mjs`'s own header comment (lines 12-13) claims a *third*, different, stale path: `~/.cx/cache/embeddings/<sha256>.json`. Doc, in-file comment, and real code path all disagree. A different, real `cacheDir()`-rooted embeddings path does exist, for downloaded ONNX model weights: `cacheDir()/embeddings/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx` (`lib/bootstrap/built-ins.mjs:57-62`; `lib/storage/embeddings-local.mjs:15,27,39`; `lib/uninstall/uninstall.mjs:98`). |
| `.runtime` | Confirmed | `lib/doctor/watchers/disk.mjs:58`; `lib/doctor/watchers/service-health.mjs:68` — `join(cacheDir(), '.runtime')`. |
| "regenerable transients" (general) | Confirmed, broadly accurate | `lib/maintenance/cleanup.mjs:179` ages out `cacheDir()` contents generically. |

Undocumented items actually in the cache root: `bin/<version>/construct-<platform>` — versioned
downloaded-binary cache for a not-yet-wired npm-downloader shim (`bin/construct-shim.mjs:22,76-78,103`;
not the published `bin` entry per its own header, so inactive today but real, tested code).

### Area 4 — The "clean break" claim and the status of `~/.cx/`

**4a. Doc claim (line 23): "no read or migration of a legacy `~/.construct/*` tree… `construct
doctor` flags a missing user config until you do."** False as written; needs qualification.

- The doctor-flag half is true: `bin/construct:998` —
  `add('User config ready', fs.existsSync(getUserEnvPath(HOME)) || fs.existsSync(configDir(HOME)), true);`;
  `lib/health-check.mjs:120-126` has a matching check.
- The "no read/migration" half is directly contradicted: `lib/config/legacy-config-migration.mjs:1-7`
  (header: "one-time forward migration from the pre-XDG `~/.construct/config.env`… mirrored
  forward"); `legacyConfigPath()` (lines 23-25) returns `path.join(homeDir, '.construct', 'config.env')`;
  `migrateLegacyModelConfig()` (76-97) and `migrateLegacyCredentialConfig()` (103-125) both read
  and forward-write. Both are actually invoked: `bin/construct:797-811` (inside `construct
  doctor`) and `lib/setup.mjs:475,480` (`construct install --footprint=user`).
- Net: the doc's absolute claim is wrong for a defined, narrow slice of legacy state
  (model-tier env overrides + credential/API-key env vars + `CONSTRUCT_OP_ENV_FILE`). It remains
  true that no *full* legacy migration (providers.json, embed.yaml, etc.) exists — only this
  narrow env-var slice does.

**4b. What `~/.construct/` actually is today — not simply "legacy."** It is also the live,
current, actively-used root for machine-scoped project state, per ADR-0066:
`lib/state-root.mjs:1-33` (header: "Two distinct scopes live under `~/.construct/`… Per-project
state… `~/.construct/projects/<key>/` — traces, observations, the vector index, task
graphs… Machine-shared state… `~/.construct/runtime/`"); `stateHomeDir()` at line 42-44.
Confirmed live consumers include `lib/status.mjs:936`, `lib/observation-store.mjs:38`,
`lib/service-manager.mjs:377,384`, `lib/directives/due-tracker.mjs:15`, `lib/embed/inbox.mjs:121`,
`lib/embed/daemon.mjs:141`, `lib/resources/budget.mjs:63`, `lib/graph/relational/sqlite-db.mjs:49`,
`lib/runtime/whisper-bootstrap.mjs:41`, `lib/runtime/uv-bootstrap.mjs:47`,
`lib/storage/admin.mjs`, `lib/storage/vector-client.mjs:28`, `lib/orchestration/run-store.mjs:27`,
`lib/orchestration/runtime.mjs:860`, `lib/orchestration/run-store-sqlite.mjs:45`,
`lib/sources/repo-cache.mjs:69,73`, `lib/telemetry/client.mjs:56`,
`lib/telemetry/backends/local.mjs:20`, `lib/worker/run.mjs:36`, `lib/worker/trace.mjs:77`,
`lib/flows/checkpoint.mjs:49`, `bin/construct:1191`. `bin/construct:775-790` (a `construct doctor`
check) explicitly frames legacy in-project directories as superseded because "durable state now
lives at `~/.construct/projects/<key>/` (ADR-0066)" — the code's own comments treat
`~/.construct/` as current, not legacy. `lib/uninstall/uninstall.mjs` never lists
`~/.construct/projects/` as removable at all — only the XDG dirs and `doctorRoot()` are covered
— so this ADR-0066 state isn't cleaned up by `construct uninstall` (an adjacent gap found in the
same pass, outside this question's exact scope). None of config.md's three rows mention
`~/.construct/` or ADR-0066 at all.

**4c. What `~/.cx/` actually is.** Doc's Core env-var table (lines 82-83) states `HOME` is the
base for "the XDG user dirs… and `~/.cx/`", and `CX_DATA_DIR` overrides "`.cx/` data
directories." Findings: **there is no code path joining `homedir()`/`HOME` directly with a
literal `.cx`** (grepped `homedir(), '.cx'` / `HOME, '.cx'` / etc. — zero hits). `.cx` as a
*project* marker is legacy: `lib/config-dir.mjs:36-40` keeps `.cx` only as a deprecated
pre-ADR-0074 project-local name, migrated forward into `.construct/` by
`lib/reconcile/legacy-layout-migration.mjs` (`LEGACY_CONFIG_DIR = '.cx'` at line 31; `apply()` at
103-125) — unrelated to `$HOME`/`CX_DATA_DIR`. `.cx` as a *global* subdirectory is real but nests
inside `doctorRoot()`, not directly under `$HOME`: `lib/hooks/session-start.mjs:69` —
`join(doctorRoot(), '.cx', 'context.md')`; `lib/hooks/pre-compact.mjs:286,288,291`. `CX_DATA_DIR`
substitutes for `doctorRoot()` (`lib/service-manager.mjs:86`), not for a separate `~/.cx/` tree;
also consumed by `lib/embed/demand-fetch.mjs:209`, `lib/embed/daemon.mjs:120-125`,
`lib/knowledge/search.mjs:393`, `lib/mcp/tool-definitions-memory.mjs:143`. Several stale file
headers describe paths as `~/.cx/...` when the code actually resolves through
`doctorRoot()`/`stateDir()` (`lib/doctor/index.mjs:11`, `lib/oracle/index.mjs:6`,
`lib/embed/semantic.mjs:12-13`, `lib/maintenance/cleanup.mjs:31`), plus one that misattributes to
the *other* wrong root (`bin/construct:8506`). **Conclusion: `~/.cx/` as a literal,
`$HOME`-rooted, `CX_DATA_DIR`-overridable directory does not exist.** What exists under that name
is (1) a deprecated project-local directory name being migrated away from, and (2) an unrelated
subdirectory nested inside the XDG state dir. The doc's Core-table row conflates both with a
directory that isn't real.

### Doc-drift summary table (15 items, severity-ranked)

| # | Doc claim | Reality | Severity |
|---|---|---|---|
| 1 | "No read or migration of a legacy `~/.construct/*` tree" | Live, wired migration of model-tier + credential env vars, run by both `construct doctor` and `construct install --footprint=user` | High |
| 2 | `~/.construct/` implied purely legacy | ADR-0066 makes it a live, current, heavily-used 4th root, entirely undocumented | High |
| 3 | `~/.cx/` tied to `$HOME`/`CX_DATA_DIR` (Core table) | No such literal directory exists | High |
| 4 | Cache root: `cache/embeddings` | Actually lives under the **state** root | Medium-High |
| 5-7 | Config root: `custom-credentials.json`/`provider-subscriptions.json`/`boundary.json` | Not found anywhere in code | Medium |
| 8 | Config root: `config.json` | Only real reference is project-scoped, not user-scope | Medium |
| 9 | State root: `dashboard.json` | Not found anywhere in the repo | Medium |
| 10 | State root: `intake-daemon.heartbeat` | Not found; real file is `runtime/oracle/heartbeat.json` | Medium |
| 11 | State root: `vector/lancedb` as canonical | Real runtime code prefers `~/.construct/projects/<key>/lancedb` unless a managed install set `CONSTRUCT_LANCEDB_PATH` | Medium |
| 12-13 | Config root omits `plugins/` dir, `skills/` dir | Both real, undocumented | Low-Medium |
| 14 | State root omits ~20+ telemetry/hook state files | Doc's state-root list is a small, unrepresentative sample | Low individually / Medium in aggregate |
| 15 | Cache root omits `bin/<version>/` | Real but inactive-today shim cache path | Low |

### Method notes / unverified

Did not exhaustively enumerate every hook-scoped state file under `doctorRoot()` (the doc's list
is such a small subset that a complete enumeration wouldn't change the finding). Whether
`bin/construct-shim.mjs`'s cache path is reachable by any currently-shipped install flow:
unverified beyond the file's own header. Did not execute `construct doctor`/`construct install`
live — all claims are from static reading of cited source lines, not observed runtime output.

</details>

## Part 3 — Head-to-head comparison

| Dimension | Parallel (lead + 4 workers) | Single-worker baseline | Winner |
|---|---|---|---|
| Wall-clock | ≤3m53s (lead-bracketed) | 6m6s (harness-measured `duration_ms`) | Parallel, on raw wall-clock |
| Token/tool cost visibility | **Unavailable** — Explore workers returned no `<usage>` block | 152,678 tokens, 36 tool calls (harness-reported) | Baseline — the only arm with real cost numbers |
| Distinct verified findings | ~10 (3 dead config files, 2 dead state files, 1 wrong-root cache claim, 1 internal resolver inconsistency, 1 wrong-scope claim, 1 confirmed-narrow migration contradiction, plus assorted undocumented items per worker) | 15 severity-ranked items, including **3 High-severity items the parallel run never found at all** (the real ADR-0066 4th root, the nonexistent `~/.cx/`, and the lancedb override chain) | **Baseline, decisively** |
| Depth per finding | Good, but bounded by each worker's assigned root — no worker was chartered to chase a lead outside its row | Followed cross-cutting leads (e.g., "what actually reads `CONSTRUCT_LANCEDB_PATH` at runtime, not just what writes the default") wherever they went | Baseline |
| Evidence discipline | 2 of 4 workers fabricated impossible-to-produce timestamps when told to decline honestly instead; 2 correctly declined | Real bash timestamps, internally consistent with lead's own clock | Baseline, on the one arm where I could compare honesty under identical instructions |
| Non-overlap / duplicate findings | 0% measured overlap (45/45 distinct citations) | N/A (single worker) | Parallel "wins" a property that only exists because it has multiple workers — not evidence of superiority, just evidence the assignment was well-drawn for what it *did* cover |
| Synthesis/integration overhead | Required (this document); real cost not reflected in the wall-clock number above | None — the baseline's output was already integrated | Baseline, when overhead is counted |

## Go/No-Go verdict

**No-go for this class of problem** — bounded, single-session codebase-archaeology research
where the correct decomposition is not yet known and the risk is exactly that a fixed a-priori
partition (even one lifted straight from the target document's own structure) hides
cross-cutting facts that don't respect anyone's assigned boundary. On every axis that matters
for a research deliverable — completeness, depth, and honest cost accounting — the single
strong worker won here, and on the one axis parallel appeared to win (wall-clock), the margin
(≤3m53s vs 6m6s) is not large enough to justify shipping a deliverable that missed three
high-severity findings the single worker caught, especially once synthesis overhead (this
document) is added back into the parallel arm's true cost.

This is not a blanket verdict against lead+worker fan-out — directive §10/§15 correctly scope
parallelism to plans where independence is *actually* known in advance (e.g., "enumerate every
hook file" vs. "enumerate every CLI command" as genuinely disjoint inventory tasks with no shared
unknowns), and nothing here tests that case. What this spike does show, with real evidence: when
the task is "find out what's actually true about a system whose true boundaries aren't yet
known" — which is most of the workspace-control-plane program's own research work — decomposing
early costs more than it saves, because the decomposition itself is a hypothesis that needs
falsifying, and only a worker free to roam catches it being wrong. Recommendation for any future
bead considering lead+worker fan-out: default to a single strong worker for open-ended discovery
research; reserve fan-out for enumeration/inventory work with a pre-validated non-overlapping
partition, and even then, budget a synthesis pass specifically hunting for cross-cutting facts
the partition might have hidden.

## Evidence trail (files behind every claim above)

- [`spikes/b-parallel-research/decomposition.md`](../spikes/b-parallel-research/decomposition.md) — pre-dispatch plan (mtime precedes worker files)
- [`spikes/b-parallel-research/workers/w1-config.md`](../spikes/b-parallel-research/workers/w1-config.md)
- [`spikes/b-parallel-research/workers/w2-state.md`](../spikes/b-parallel-research/workers/w2-state.md)
- [`spikes/b-parallel-research/workers/w3-cache.md`](../spikes/b-parallel-research/workers/w3-cache.md)
- [`spikes/b-parallel-research/workers/w4-legacy.md`](../spikes/b-parallel-research/workers/w4-legacy.md)
- `docs/guides/reference/config.md` (lines 13-23, 82-83, 165) — the document under audit
- `lib/config/xdg.mjs`, `lib/config/legacy-config-migration.mjs`, `lib/state-root.mjs`,
  `lib/config-dir.mjs`, `lib/config/project-config.mjs`, `lib/embed/semantic.mjs`,
  `lib/doctor/watchers/disk.mjs`, `lib/doctor/watchers/service-health.mjs`,
  `lib/hooks/session-start.mjs`, `lib/hooks/pre-compact.mjs` — source cited throughout Parts 1-2,
  independently re-opened by the lead for the Part 1 spot-check table
