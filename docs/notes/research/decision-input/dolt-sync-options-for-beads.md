---
intake: none
intake_rationale: Durable ADR decision-input research; moved from .cx/research/ for vanilla package tree.
---

# Research Brief: Dolt Sync Options for Beads (DoltHub vs DoltLab vs filesystem/object-store remote vs git-native)

- **Date / access date for all sources**: 2026-06-04
- **Recency baseline**: Searched 2026 first. Key sources are 2026-dated (Dolt Git-remote support 2026-02-13; beads v0.56.0 changelog 2026-02-23; DoltHub Pro pricing 2026-04-24). Canonical local-first essay is 2019 (foundational, not time-sensitive).
- **No-fabrication note**: Pricing, host requirements, and version numbers are quoted from primary sources. Anything not confirmed is marked `[unverified]`. Per rules/common/no-fabrication.md.
- **Repo state grounding** (this repo, read 2026-06-04):
  - `.beads/metadata.json` → `{"database":"dolt","backend":"dolt","dolt_mode":"embedded","dolt_database":"construct"}`
  - `.gitignore` ignores `.beads/issues.jsonl`; `.beads/config.yaml` still documents a "JSONL backup (periodic export… Auto-enabled when a git remote exists)" block — reflects an **older** beads sync model than current upstream (see Topic 4 / Counter-evidence).
  - `bd dolt remote list` → "No remotes configured." Issues live only in the embedded Dolt DB.

---

## Executive summary

- **DoltHub is "GitHub for data"**: a hosted remote where you clone/push/pull Dolt databases. Public data hosting is **free**; **private** storage is **free up to 100 MB**, then **DoltHub Pro at $5/month up to 5 GB**, then **$1/GB/month**. Pushing requires a DoltHub account + network.
- **A Dolt remote is NOT a git remote by default — they are separate mechanisms**, BUT as of **Dolt v1.81.10 (2026-02-13)** Dolt can use a **Git remote (e.g. GitHub) directly as a Dolt remote**, storing its data on a hidden ref `refs/dolt/data` inside the git repo.
- **Multiple Dolt remote backends avoid any SaaS account**: a plain **filesystem directory (`file://`)**, **AWS S3 (`aws://`)**, **GCS (`gs://`)**, **OCI (`oci://`)**, and **git remotes**. Only DoltHub/Hosted Dolt are SaaS; DoltLab is self-hostable.
- **Beads' current intended sync IS Dolt-native push/pull via git remotes.** Upstream **removed the entire JSONL sync system in v0.56.0 (2026-02-23)**; `bd init` **auto-configures git origin as the Dolt remote**; `.beads/issues.jsonl` is now "an optional export… not the canonical source of truth, not cross-machine sync, and not a full backup." No separate SaaS required.
- **Local-first best practice favors git-native metadata** over a hosted SaaS data service for a local-first dev tool: offline-by-default, zero extra credentials, no vendor lock-in, single source of truth in the same repo as the code. git-bug and Fossil are prior art for "issues live in version control."

---

## Topic 1 — What is DoltHub

- **Dolt one-liner**: "Dolt is Git for Data!" — "a SQL database that you can fork, clone, branch, merge, push and pull just like a Git repository." Open source, **Apache-2.0**. [github.com/dolthub/dolt — fetched 2026-06-04]
- **DoltHub** = "a place to share Dolt databases." "We host public data for free!" — the **hosted remote** model for Dolt: clone/fetch/pull/push, public vs private repos, account-based auth. The DoltHub remote endpoint is `https://doltremoteapi.dolthub.com/`. [dolthub.com/docs + /docs/guides/concepts/dolt/git/remotes — fetched 2026-06-04]
- **Pricing (primary)**: public databases free; private storage "100 MB of private data storage free"; "$5/month" until private data reaches 5 GB; beyond 5 GB, "$1/GB/month." [dolthub.com/blog/2026-04-24-announcing-dolthub-pro-for-5-dollars-per-month/ — fetched 2026-06-04]
- **Account / network required?** Yes — pushing to DoltHub requires a DoltHub account and network connectivity (inferred from the SaaS hosted-remote model; reading public data is free and open).

---

## Topic 2 — Dolt remote backends (the alternatives to DoltHub)

Configured with `dolt remote add <name> <url>` [dolthub.com/docs/guides/concepts/dolt/git/remotes + /docs/sql-reference/version-control/remotes — fetched 2026-06-04]:

| Backend | URL scheme / example | SaaS account needed? |
|---|---|---|
| DoltHub (hosted) | `https://doltremoteapi.dolthub.com/` | **Yes** (DoltHub account) |
| Filesystem dir | `file:///Users/.../datasets/menus` | **No** |
| AWS S3 | `aws://[table:bucket]/menus` | **No** (your AWS creds) |
| Google Cloud Storage | `gs://BUCKET/path` | **No** (your GCP creds) |
| Oracle Cloud (OCI) | `oci://BUCKET/path` | **No** (your OCI creds) |
| Git remote (GitHub/GitLab/self-hosted) | `.git` URL, `https://…/REPO.git`, `git@…:ORG/REPO.git` | **No** (uses your existing git host) |

- **Push/pull works to a plain directory or object store without any DoltHub account.** [dolthub.com/docs/guides/concepts/dolt/git/remotes — fetched 2026-06-04]
- **Self-hosted option = DoltLab**: "all the features of DoltHub… in your own network or on your development machine." Requirements: an internet-accessible **Ubuntu 22.04 amd64 (t2.xlarge recommended)** host, **Docker** to run all services, and a working **SMTP server** to create users. [dolthub.com/docs + docs.doltlab.com — fetched 2026-06-04; deep links partially redirected, graded B2]

---

## Topic 3 — Dolt vs Git for sync

- **Conceptually the same, mechanically separate**: Dolt and Git remotes both "coordinate distributed clones and let you clone, fetch, pull, and push." Dolt versions *tables*; Git versions *files*; a Dolt remote is **not** automatically a git remote. [dolthub.com/docs/guides/concepts/dolt/git/remotes — fetched 2026-06-04]
- **NEW (2026): Dolt can push to a git host directly.** As of **Dolt v1.81.10 (announced 2026-02-13)**, "Dolt now supports using Git remotes (GitHub, GitLab, etc.) as Dolt remotes." Data is stored on a custom ref `refs/dolt/data` within the git repo, "invisible to normal Git operations." Limitations: requires the **git binary on PATH**, the repo must **already exist with ≥1 branch**, and a **v1.81.10 bug** breaks git-remote use "if your Git binary requires username and password credential inputs via STDIN." [dolthub.com/blog/2026-02-13-announcing-git-remote-support-in-dolt/ — fetched 2026-06-04]

**Takeaway**: "sync through git" and "use a Dolt remote" are no longer mutually exclusive. Dolt-on-git-ref lets issue history ride the **existing git origin** with no separate service, keeping Dolt's cell-level merge semantics (data on a hidden ref, NOT as JSONL in the working tree).

---

## Topic 4 — Beads' intended sync model

- **Beads is Dolt-powered, git-native, CLI-first, offline-capable.** "Works offline, syncs when you push." [.beads/README.md (this repo) + steveyegge.github.io/beads — fetched 2026-06-04]
- **Current sync = Dolt-native push/pull via git remotes. JSONL sync was removed.** Changelog **v0.56.0 (2026-02-23)**: "the entire JSONL-based sync system… has been removed. Dolt-native push/pull via git remotes is the only sync mechanism." [beads CHANGELOG — fetched 2026-06-04]
- **git origin is auto-used as the Dolt remote**: "bd init auto-configures git origin as the Dolt remote when present." Sync transfers data via `refs/dolt/data`, separate from source branches. [beads FAQ — fetched 2026-06-04]
- **issues.jsonl is NOT the source of truth** (v1.0.5, 2026-05-28): "an optional export… not the canonical git-tracked source of truth, not cross-machine sync, and not a full database backup. Use `bd dolt push`/`bd dolt pull` for sync." JSONL import is upsert-only (cannot infer deletes). [beads CHANGELOG/SYNC_CONCEPTS/FAQ — fetched 2026-06-04]
- **No SaaS / no DoltHub required**: host the Dolt remote on any git platform (GitHub, GitLab, self-hosted). [github.com/steveyegge/beads/discussions/2332 + FAQ — fetched 2026-06-04]

**Repo-specific caveat (counter-evidence)**: this repo's `.beads/config.yaml` still documents the OLD "JSONL backup… auto-enabled when a git remote exists" model, implying the installed `bd` here predates v0.56.0. **Verify the local `bd version` / `dolt version` before relying on git-native push semantics.** `[needs-local-verification]`

---

## Topic 5 — Local-first / git-native metadata best practices

- **Local-first definition (foundational)**: "Local-first software: you own your data, in spite of the cloud" (Kleppmann, Wiggins, van Hardenberg, McGranaghan, 2019). Seven ideals incl. "the network is optional," "your work is not trapped on one device," "the Long Now" (longevity), and "you retain ultimate ownership and control." Critique of cloud-SaaS: "you don't have full ownership of that data — the cloud provider does." [inkandswitch.com/essay/local-first/ — fetched 2026-06-04]
- **git-bug (prior art)**: "Distributed, offline-first bug tracker embedded in git" — "embeds issues, comments, and more as objects in a git repository (_not files!_)," push/pull to remotes, optional bridges to GitHub/GitLab. [github.com/git-bug/git-bug — fetched 2026-06-04]
- **Fossil (prior art + nuance)**: keeps tickets inside the version-controlled repo and auto-merges them across clones, BUT explicitly argues *against* storing tickets as files in the source tree (immutability, clutter, access control). Supports "issues in version control" while cautioning against the naive "issues as committed files" form. [fossil-scm.org/.../bugtheory.wiki — fetched 2026-06-04]

**Synthesis**: local-first ideals map onto **git-native metadata via the existing git origin**, not a separate hosted data service. The right git-native form is **Dolt-on-`refs/dolt/data`** — NOT committing a churning `issues.jsonl` into the source tree (merge noise, upsert-only, loses deletes).

---

## Comparison table — the four sync options

| Option | SaaS account? | Network to sync | Vendor lock-in | Source of truth | Setup | Notes |
|---|---|---|---|---|---|---|
| **DoltHub (hosted)** | Yes | Yes | Medium (data portable via clone) | Remote Dolt repo | Lowest | Public free; private 100 MB free → $5/mo ≤5 GB → $1/GB/mo |
| **DoltLab (self-hosted)** | No | Yes (to your host) | Low | Your DoltLab server | **Highest** — Ubuntu host + Docker + SMTP | Heavy to run |
| **Filesystem / object-store remote** (`file://`, S3/GCS/OCI) | No | Only to the store | Low | The dir/bucket | Medium | Good for backup/team store; not in git |
| **Git-native (Dolt on `refs/dolt/data`)** | No | Only when you already git push | **Lowest** | The git repo (hidden ref) | **Lowest** — beads auto-configures git origin | Beads' default since v0.53–0.56; needs Dolt ≥ v1.81.10 + git on PATH |

---

## Counter-evidence and caveats

1. **Version mismatch risk** (strongest counter to "just use git-native today"): this repo's `.beads/config.yaml` documents the JSONL model removed in v0.56.0, so the installed `bd` may predate Dolt-native git-remote sync. **Confirm `bd version` / `dolt version` (need Dolt ≥ v1.81.10).** `[needs-local-verification]`
2. **Known bug**: Dolt v1.81.10 git-remote breaks if the git binary prompts for username/password via STDIN; SSH or a credential helper avoids it.
3. **Fossil's caution** is against naive "tickets as files," not against git-native metadata in general (the hidden-ref form is exactly what `refs/dolt/data` is).
4. **DoltHub is not data lock-in** — data is portable (clone out anytime); the cost is operational/credential friction, not data capture.

---

## Recommendation (evidence-based; decision left to architect/PM)

**Primary: adopt the git-native path — beads uses the existing git origin as its Dolt remote (`refs/dolt/data`), contingent on a version check.** Best satisfies local-first ideals (network-optional, no extra credentials, no SaaS, single repo as source of truth, lowest ops), matches beads' own default design, and adds only single-digit MB to git. **Do NOT** switch to committing `issues.jsonl` into the tree (upsert-only, loses deletes, merge noise).

**Flip conditions:**
- `bd`/`dolt` older than Dolt-native git-remote support (Dolt < v1.81.10 / beads < v0.53) → upgrade first, or fall back to a **filesystem/object-store Dolt remote** (no SaaS) on the current binary.
- HTTPS-credential STDIN bug blocks git-remote push and SSH/helper unavailable → fall back to a filesystem/S3 remote or DoltHub's free private tier (≤100 MB easily covers the issue count).
- **DoltLab** only if a self-hosted web UI with PRs/issues is a hard requirement — its footprint is disproportionate for solo/small-team sync.

---

## Sources (all fetched 2026-06-04)

1. Dolt repo / tagline / license — https://github.com/dolthub/dolt
2. Dolt docs index — https://www.dolthub.com/docs/
3. Dolt remotes concept (file://, aws://, gs://, oci://, git) — https://www.dolthub.com/docs/guides/concepts/dolt/git/remotes
4. Dolt SQL-reference remotes — https://www.dolthub.com/docs/sql-reference/version-control/remotes
5. Dolt Git-remote support (v1.81.10, refs/dolt/data, STDIN bug) — https://www.dolthub.com/blog/2026-02-13-announcing-git-remote-support-in-dolt/
6. DoltHub Pro pricing — https://www.dolthub.com/blog/2026-04-24-announcing-dolthub-pro-for-5-dollars-per-month/
7. DoltLab self-host requirements — https://docs.doltlab.com/administrator-guides/installation
8. Beads docs site — https://steveyegge.github.io/beads/
9. Beads CHANGELOG (JSONL removal; JSONL-as-optional-export) — beads CHANGELOG.md
10. Beads FAQ (git origin auto-configured as Dolt remote) — https://github.com/steveyegge/beads/blob/main/docs/FAQ.md
11. Beads SYNC_CONCEPTS — https://github.com/steveyegge/beads/blob/main/docs/SYNC_CONCEPTS.md
12. Beads discussion #2332 — https://github.com/steveyegge/beads/discussions/2332
13. Ink & Switch — "Local-first software" (2019) — https://www.inkandswitch.com/essay/local-first/
14. git-bug — https://github.com/git-bug/git-bug
15. Fossil SCM bug/ticket theory — https://fossil-scm.org/home/doc/trunk/www/bugtheory.wiki
16. Repo state — `.beads/metadata.json`, `.beads/config.yaml`, `.gitignore` (read 2026-06-04)
