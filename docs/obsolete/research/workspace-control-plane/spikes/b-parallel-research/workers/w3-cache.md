---
intake: none
---

Obsolete: retained as historical workspace-control-plane research; Construct 2.0 uses Worker Profiles, Workspace Presets, and `.construct/` — see docs/obsolete/legacy-surface-register.md.

# W3-Cache: XDG Cache Root Implementation Audit (raw worker output, saved verbatim by lead)

> Lead note: like W1, this worker is an `Explore` agent (Read/Glob/Grep only, no Bash) and
> could not have actually run `date -u`. It did not include explicit HH:MM:SS timestamps in
> its returned text at all (unlike W1) — it skipped the requirement rather than fabricating
> or declining explicitly. Treated as a second instance of the same instruction not being
> followed reliably; see synthesis doc.

---

## Summary of Findings

Systematic investigation of whether Construct's actual implementation matches the documented `$XDG_CACHE_HOME` root behavior (docs/guides/reference/config.md line 21).

### MAJOR DRIFT DETECTED

The documentation claims the cache root holds: `cache/embeddings`, `.runtime`, and "regenerable transients."

**The actual implementation deviates significantly:**

#### 1. cache/embeddings — WRONG LOCATION
- Documented: `~/.cache/construct/cache/embeddings`
- Actual: `~/.local/state/construct/cache/embeddings`
- Citation: `lib/embed/semantic.mjs` line 27 uses `join(doctorRoot(), 'cache', 'embeddings')` where `doctorRoot()` returns `stateDir()` (see `lib/config/xdg.mjs` lines 55-59)
- Embeddings read/written via `embed()` function at lines 102-141

#### 2. .runtime — WRONG LOCATION (with inconsistency)
- Documented: `~/.cache/construct/.runtime`
- Actual (embed daemon): `~/.local/state/construct/runtime`
- Citation: `lib/embed/cli.mjs` lines 46-47: `return path.join(doctorRoot(homeDir), 'runtime')`
- Embed daemon state and logs written here (lines 39-56)
- Inconsistency: `lib/doctor/watchers/service-health.mjs` line 68 and `lib/doctor/watchers/disk.mjs` line 58 attempt to use `join(cacheDir(), '.runtime')`, which conflicts with the embed daemon's actual location under state

#### 3. Other "cache" artifacts actually stored in STATE directory (not cache)
- `lib/models/catalog.mjs` line 43: `model-catalog-cache.json` -> state dir
- `lib/models/provider-poll.mjs` line 44: provider poll cache -> state dir
- `lib/telemetry/model-pricing-catalog.mjs` line 25: `pricing-cache.json` -> state dir
- `lib/hooks/ci-status-check.mjs` line 35: `ci-status-cache.json` -> state dir
- `lib/cache-governor.js` line 16: `cache-strategy.json` -> state dir

#### 4. What IS legitimately in cacheDir()
- Embedding model binary cache: `lib/bootstrap/built-ins.mjs` lines 58-61 probes for `~/.cache/construct/embeddings/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx`
- This is the HuggingFace transformers library cache — distinct from the semantic embeddings cache in finding #1 (naming collision: both are called "embeddings" but one is `cache/embeddings` under state, the other is `embeddings/...` directly under the real XDG cache dir)

#### 5. Cache root resolver implementation (correct)
- File: `lib/config/xdg.mjs` lines 61-64
- Correctly honors `$XDG_CACHE_HOME` when absolute path
- Correctly defaults to `~/.cache/construct`
- Correctly rejects relative/empty env values

### Key Drift Summary

| Item | Documented | Actual | File Reference |
|---|---|---|---|
| cache/embeddings | `~/.cache/construct/cache/embeddings` | `~/.local/state/construct/cache/embeddings` | lib/embed/semantic.mjs:27 |
| .runtime | `~/.cache/construct/.runtime` | `~/.local/state/construct/runtime` | lib/embed/cli.mjs:46-47 |
| model-catalog-cache.json | Should be in cache root | Stored in state root | lib/models/catalog.mjs:43 |
| pricing-cache.json | Should be in cache root | Stored in state root | lib/telemetry/model-pricing-catalog.mjs:25 |
| ci-status-cache.json | Should be in cache root | Stored in state root | lib/hooks/ci-status-check.mjs:35 |

The "regenerable transients" claim is partially supported by a cleanup function (`cleanupCacheDir` in `lib/maintenance/cleanup.mjs:178-200`), but most actual transients/caches are stored in the state directory via `doctorRoot()` instead of the cache directory via `cacheDir()`.

**Scope boundary respected:** did not investigate config/state root file inventories or the legacy migration claim.
