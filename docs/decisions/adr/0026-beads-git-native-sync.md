---
intake: none
intake_rationale: infrastructure decision recorded from research brief docs/notes/research/decision-input/dolt-sync-options-for-beads.md and a verified local trial; not routed through an intake packet.
last_verified_at: 2026-06-04
verified_by: construct · git-native push verified (refs/dolt/data on origin)
---

# ADR 0026: Beads issue history syncs git-native via the existing origin, not a hosted data SaaS

**Date:** 2026-06-04
**Status:** Accepted
**Deciders:** Construct·Architect
**Supersedes:** none

---

## Problem

Construct tracks issues in beads, which stores them in an embedded Dolt database (`.beads/embeddeddolt`). With no Dolt remote configured, that history was stranded on a single machine: closes, new issues, and status never left the local disk, so a second machine, a fresh clone, or a future session saw none of it. Issue history is project memory — it has to be durable and shareable across machines, sessions, and agents.

The obvious reach for "shareable database" is a hosted data service such as DoltHub. That introduces an external account, network dependency, and a vendor relationship for what is otherwise local project state — the decision-forcing tension is whether shared issue history is worth taking on a SaaS dependency.

## Context

- Construct is local-first and **touch-free**: local infrastructure is bootstrapped without prompting the user for credentials. It is also vendor-agnostic by policy (telemetry and infra prefer open, portable mechanisms over vendor coupling), and [ADR 0001](0001-zero-npm-core.md) keeps the external surface minimal.
- Dolt supports several remote backends (research brief, 2026-06-04): DoltHub (hosted SaaS), DoltLab (self-hosted, requiring an Ubuntu host + Docker + SMTP), filesystem/`file://`, AWS S3/GCS/OCI object stores, and — since Dolt v1.81.10 (2026-02-13) — **git remotes**, where Dolt data lives on a hidden `refs/dolt/data` ref inside the existing git repository.
- Beads' own design moved the same direction: it removed the JSONL sync system (v0.56.0) and made Dolt-native push/pull over a git remote the sync path, auto-configuring git origin as the Dolt remote; `issues.jsonl` is an optional export, not the source of truth.
- Local verification (2026-06-04): `bd` 1.0.3 with embedded Dolt, git `credential.helper=osxkeychain`, HTTPS origin. `bd dolt remote add origin <git-url>` registered as `git+https://…`, and `bd dolt push` succeeded — `refs/dolt/data` now exists on origin with all branches untouched. The git-native path works on the installed build; the v1.81.10 STDIN-credential bug does not bite because osxkeychain answers non-interactively.

## Decision

Beads syncs issue history **git-native**: the Dolt remote is the existing git origin, with data carried on `refs/dolt/data`. Construct does not use a hosted data SaaS (DoltHub) or a self-hosted data server (DoltLab) for issue sync, and does not treat `issues.jsonl` as a synced source of truth.

## Rationale

The git-native path rides the repository Construct already pushes to, so issue history inherits the credentials, network posture, and durability of the code itself — no new account, no extra service, offline-capable, and a single source of truth in one repo. That is a direct match for Construct's local-first, touch-free, vendor-agnostic, and minimal-dependency commitments, and it is the model beads itself now defaults to. It was not adopted on principle alone: the push was exercised end to end and verified against origin before this decision was recorded.

## Rejected alternatives

- **DoltHub (hosted SaaS).** Requires a DoltHub account and network to push, and adds a vendor relationship for local project state — against the touch-free (no credential prompts for infra) and vendor-agnostic commitments. The data itself stays portable (clone out anytime), so the cost is credential and dependency friction rather than lock-in, but that friction is exactly what the local-first posture exists to avoid. Rejected.
- **DoltLab (self-hosted DoltHub).** Removes the third-party SaaS but requires running an Ubuntu host with Docker and an SMTP server (research brief). Disproportionate operational weight for syncing issues in a solo/small-team setting. Rejected.
- **Filesystem / object-store Dolt remote (`file://`, S3, GCS, OCI).** No SaaS account, works on the current binary, but the data lives outside the git repo as a separate artifact to provision and back up — more moving parts than riding the origin that already exists. Retained only as a fallback if a build ever lacks git-remote support. Rejected as the default.
- **Commit `issues.jsonl` into the source tree.** Beads treats the JSONL as an optional export whose import is upsert-only — it cannot represent deletions, and a churning generated file in the tree produces merge noise. Rejected as a lossy, noisy substitute for the Dolt-on-ref sync.

## Consequences

- Issue history is durable and shareable with zero new infrastructure; a fresh clone picks up the remote via `bd init`, and this session's closes and new issues are already on origin.
- Beads' auto-export writes `.beads/issues.jsonl` after every write and, by default (`export.git-add: true`), tries to `git add` it — which fails because the file is gitignored, logging `auto-export: git add failed` on each mutation. Setting `export.git-add: false` (`.beads/config.yaml`) disables only the staging step; the local export still runs for viewers, the log is gone, and `issues.jsonl` correctly stays out of git, consistent with the Dolt remote being the source of truth.
- Sync depends on the embedded Dolt supporting git remotes (Dolt ≥ v1.81.10) and on a non-interactive git credential path; an HTTPS origin without a credential helper, or an older embedded Dolt, would force the object-store fallback.
- A `refs/dolt/data` ref now lives in the origin repository (single-digit MB for this issue count), invisible to normal git operations.

## Reversibility

Two-way door. A filesystem or S3 remote can be added as an additional backup mirror, and migrating to DoltHub later (if a hosted web UI for issues ever becomes a hard requirement) is a remote reconfiguration plus a superseding ADR. The `refs/dolt/data` ref can be removed from origin to fully back out.

## References

- Research brief: `docs/notes/research/decision-input/dolt-sync-options-for-beads.md` (2026-06-04)
- [ADR 0001: Zero npm dependencies in core](0001-zero-npm-core.md)
- [ADR 0014: Local ONNX embeddings are an optional capability](0014-local-embeddings-optional.md)
- Dolt Git-remote support (v1.81.10): https://www.dolthub.com/blog/2026-02-13-announcing-git-remote-support-in-dolt/
- Local-first software (Ink & Switch, 2019): https://www.inkandswitch.com/essay/local-first/
- `.beads/config.yaml` (`backup.enabled: false`)
