# Release-readiness engineering audit

Recorded 2026-08-26. Auditor: Cursor cloud agent on
`geraldmaron/construct` at `d99ca890` (origin/main at audit start).
Published package exercised: `@geraldmaron/construct@3.0.0-alpha.18`.

Bar used (Gerald, this session): tester is the gate. Can a sharp
engineer install the published alpha, use it, and trust it? Competitive,
well built, well thought out. STRATEGY.md Phase 5 / stakeholder-acceptance
is not the gate.

## Verdict: not ready

A stranger can install the alpha and record an outcome in seconds. They
cannot finish the advertised walkthrough. An engineering ask either
queues the wrong seats or queues nothing. Doctor says in-session Cursor
execution is available; `work` then dies because `cursor-agent` is not
on PATH. Main CI is red on the exact class of bug this session ran as
the engineering ask.

The Engineer seat being absent is a real design, and in practice it is
also a hole. Construct does not stay in the host and let the host be the
engineer. It tries to spawn a host CLI, and when it cannot, the keyword
map fills the empty seat with false roles.

```
install @alpha  ──ok──►  doctor healthy  ──ok──►  outcome
                                              │
                    engineering ask ──────────┼──► wrong seats (measurement, coverage)
                    implementation ask ───────┼──► "no domains implicated"
                    ask (engineer Q) ─────────┼──► "no concern owns this"
                                              ▼
                                           work
                                              │
                    no host CLI ──────────────┼──► fail: cannot start cursor-agent
                    no-domain run ────────────┼──► lie: "Record an outcome first"
                    ambient "available" ──────┘──► same fail
```

## What I ran

All of this was executed, not inferred. Isolated `HOME` unless noted.

| Step | Command | Result |
|---|---|---|
| Install published alpha | `npm install -g --prefix <scratch> @geraldmaron/construct@alpha` | Worked. 0.57s. Landed `3.0.0-alpha.18`. |
| `construct doctor` (empty app dir, Node 22.22.2) | as documented | Exit 0, `doctor: healthy`. All four host binaries `not found`. Ambient: `running inside cursor … in-session execution: available`. |
| `construct doctor` (Node 22.14.0) | `/exec-daemon/node $(which construct) doctor` | Exit 1, `FAIL node v22.14.0 (floor: 22.18)`. Floor check is real. |
| First-run outcome | `construct outcome "We want to hire a contractor in Poland"` | Exit 0. Implicated `employment` + `contracts` on keywords. Matched `docs/first-run.md`. |
| Engineer ask 1 (implementation, no architecture words) | `construct outcome "Fix the CI failure where a daemon status test asserts stderr is empty but Node prints ExperimentalWarning for node:sqlite on every command"` | Exit 0. Routed to **measurement** (`experiment` inside `ExperimentalWarning`) and **coverage-gaps** (`every`). Queued a measurement plan and a coverage deliverable for a test-stderr bug. |
| Engineer ask 2 (implement a feature) | `construct outcome "Add retry with exponential backoff in the host adapter so a single transient timeout does not fail the whole dispatch"` | Exit 0. **No domains implicated.** Honest about the empty map. Suggested `--host=cursor` because it detected this session. |
| Engineer ask 3 (uses "refactor") | `construct outcome "Refactor the daemon status check so Node experimental warnings do not fail the suite"` | Exit 0. Routed to **measurement** (`experiment`) and **system-design** (`refactor`). Plan: measurement plan, then design review. |
| Grounded retry of ask 1 | `construct source add --kind=directory --locator=/workspace` then same CI-fix outcome | Still only `measurement` via `experiment`. Declaring the repo did not change the seat. |
| `construct ask` (engineer Q) | `construct ask "why does daemon.test.ts fail on empty stderr when Node warns about sqlite"` | Exit 0. `no concern in the catalog owns this question`. Suggested paying a host. |
| `construct work --run <id>` (ambient Cursor, no CLI) | after ask 3 | Exit 1. `host "cursor" is not available — Could not start "cursor-agent"`. |
| `construct work --run <id> --host=cursor` | same | Same fail. |
| `construct work --run <id> --host=claude` | same | Exit 1. `Could not start "claude"`. |
| `construct work` on the no-domain feature run | `run-20260826001053306` | Exit 0. **`nothing to work. Record an outcome first`.** The outcome exists. There are just no tasks. |
| `construct outcome --host=cursor` on the feature ask | same sentence | Exit 1. Same `cursor-agent` miss. The follow-up doctor/outcome printed is not a path this machine can take. |
| `construct show` / `plan` / `log` / `status` / `inbox` | after the above | Show: empty drafts. Plan: wrong seats named. Log: append-only, accurate. Inbox: empty. Status: correct counts. |
| `construct help` / unknown flag / lessons without `--by` | | Help prints. `--nope` on `inbox` exits 2 and names the flag. `lessons --admit=nope` exits 2 and prints usage. |
| Checkout CLI (`node bin/construct.mjs`) | `daemon status`, `schedule --help` | Exist on **main**, not on published alpha.18. `construct daemon` / `schedule` on the published binary print grouped help and exit 1. |
| Repo gate | `npm run lint && npm run typecheck && npm test && npm run smoke` | Lint clean. Typecheck clean. Smoke **pass** (packaged install of **this checkout**, not npm). Tests: **3121 pass, 2 fail, 72 skip** locally. |
| npm tags | `npm view @geraldmaron/construct@latest/@alpha version` | `latest` = **2.1.1**. `alpha` = **3.0.0-alpha.18**. Hypothesis confirmed. |
| Docs site | `curl https://geraldmaron.github.io/construct` and `gh api repos/geraldmaron/construct/pages` | **404**. GitHub Pages is not configured. Hypothesis rejected. |

Host binaries on this machine: none of `opencode`, `claude`, `codex`, `cursor`, `cursor-agent`. `CURSOR_AGENT` is set. That is why doctor and outcome named Cursor, and why work could not spawn it.

## Blockers

### 1. Main CI is red

Latest `main` push: [run 32906070025](https://github.com/geraldmaron/construct/actions/runs/32906070025) on `d99ca890`. Jobs:

- `test`: fail
- `sterile-readonly-home`: fail
- `packaged-install-smoke`: pass

The failing assertion is the same in both test jobs:

```
not ok 92 - a daemon that greets and hangs up mid-retirement reads as not running, not as a failure
location: tests/cli/daemon.test.ts:297
expected: ''
actual:   (node:…) ExperimentalWarning: SQLite is an experimental feature…
```

I reproduced it on Node 22.22.2. The product itself prints that warning on
**every** command I ran, including `doctor` and `version`. The new daemon
status test treats any stderr as "something is broken." Node 22.18 (CI pin)
and 22.22 both still mark `node:sqlite` experimental.

Locally the full suite also reported a second file-level fail in
`tests/cli/cleanup.test.ts` (inner case passed; the file exited 1). That
one is not in the GitHub log. Treat it as unconfirmed until seen on CI.

Last green `main` CI: `3d10e94c`, before the residency/daemon merge
(`construct-opp7.8`). `v3.0.0-alpha.18` release workflow is green.

This audit branch reproduced the same red on
[run 32914311678](https://github.com/geraldmaron/construct/actions/runs/32914311678)
(`3cb80f4b`, markdown-only): `test` and `sterile-readonly-home` failed on
the same `not ok 92` assertion; `packaged-install-smoke` passed. The
report did not cause the red. Main already was.

A sharp engineer who clones today sees a red badge. That is enough to
stop a release by itself.

### 2. Ambient host overpromise

Doctor, on a machine with no host CLI:

```
ok   host  cursor: not found (pinned: 2026.08.11-e8db854)
ok   ambient  running inside cursor (detected via CURSOR_AGENT); in-session execution: available
doctor: healthy
```

Then `outcome` prints:

```
Run them:  construct work --run run-… --host=cursor
```

Then `work` and `outcome --host=cursor` both fail:

```
Could not start "cursor-agent": is the Cursor CLI installed and on PATH?
```

`src/hosts/ambient.ts` says detection is "presence, not dispatch
capability" and that the caller must hold the two facts apart. The
caller does not. Doctor calls it available. The follow-up command
names a host that is not spawnable. The Engineer-seat design ("your
host is the engineer") needed Construct to stay in this Cursor
session. It tried to leave and spawn `cursor-agent` instead.

This is the break that stops first-run. Recording an outcome is free
and works. Running the work is the product, and it is unreachable
here. `docs/first-run.md` says ten minutes. Install + doctor +
outcome was about two seconds. The rest is a wall.

### 3. The absent Engineer seat is a hole

README table: Engineer → "deliberately absent: your host is the
engineer." The catalog implements that. `src/kernel/plan/lenses.ts`
gives the engineering lens `domains: []`. Nothing routes to it.
`src/kernel/implication/domains.ts` has no `engineering` row.

That design is coherent on paper: do not dispatch a worse copy of the
host. What happens when a sharp engineer actually types an engineering
ask:

| What was typed | What fired | Why | Can you `work` it? |
|---|---|---|---|
| Fix the CI stderr/sqlite warning | `measurement`, `coverage-gaps` | substring `experiment` in `ExperimentalWarning`; word `every` | Only if a host CLI exists, and then you get a measurement plan for a test bug |
| Add retry/backoff on the host adapter | nothing | no keyword hit | `work` says you never recorded an outcome |
| Refactor the daemon status check | `measurement`, `system-design` | `experiment` + `refactor` | Wrong deliverable types queued |
| `ask` why the test fails | nothing | no catalog owner | Honest empty; still not an engineer answer |

The empty-map case is the design working. The `experiment` misfire is
the design leaking. `ExperimentalWarning` is Node's word, not a
product experiment, and it is the live warning this CLI prints. A
keyword map that cannot see engineering will still grab nearby
vocabulary and staff the wrong roles.

`work` on the honest empty-map run is a second lie:

```
nothing to work. Record an outcome first: construct outcome "<what you want>"
```

I had just recorded that outcome. The guard in `src/cli/work.ts` treats
"zero pending tasks" as "no outcome exists." An engineer who did the
right thing gets told they did not.

Declaring the construct checkout as a source did not fix routing. The
keyword map still staffed measurement.

So: **hole, not a clean handoff.** The host is supposed to be the
engineer. Construct still accepts the ask, invents other seats or
denies the record, and cannot dispatch to the host it detected.

### 4. Docs the engineer will trip on

These are not nits if the tester is the gate. They are the first
surface.

**README is unreadably long for install.** 230 lines, 3608 words.
Status, withdrawn-claim history, miss-rate statistics, and a seat map
come before `npm install`. The actual start path is three lines, buried
under a research paper. `docs/first-run.md` is longer still (524 lines,
3717 words) and cannot be finished without a host CLI.

**"37 verbs" is already false on the published binary.** README:

> The surface is 37 verbs, counting `help` itself.

The table lists 36 named verbs and omits `init` and `status`. Published
`construct help` includes both. Checkout `src/cli/index.ts` `VERBS` has
41 names (`schedule`, `daemon`, plus the published 39). CHANGELOG for
alpha.18 said 39. `lint-doc-commands` only checks that a copied
`construct <verb>` exists. It does not check that the README table is
complete or that the count is true. That is why this shipped.

**`construct daemon` / `construct schedule` are documented on main and
absent from the published alpha.** `docs/scheduled-operation.md` and
checkout help describe them. `npm install @geraldmaron/construct@alpha`
does not have those verbs; they print grouped help and exit 1. package.json
is still `3.0.0-alpha.18` while main carries unreleased residency work.
A stranger who reads main docs and installs npm gets a different product.

**first-run is not ten minutes, and not completable, on a machine
without a host CLI.** The page says every command was run as written
except the ones that spend. `construct work` is in the path and it
spends. Without a spawnable host it fails. Doctor still exits healthy.

## Nits

- Every published and checkout command leaks Node's sqlite
  `ExperimentalWarning` on stderr. Scripts that treat empty stderr as
  success will flake. That is also blocker 1's proximate cause.
- No GitHub Releases UI (`gh release list` empty). Tags exist through
  `v3.0.0-alpha.18`. Fine for npm; thin for humans.
- Tags skip `v3.0.0-alpha.2`, `.10`, `.11`. npm versions match that gap.
- `package.json` `homepage` is the GitHub repo, not a docs site. There
  is no docs site.
- `docs/consumer-install.md` doctor table omits the live `ambient` line
  (and, on checkout, `schedule` / `daemon`).
- No `SECURITY.md`, `CODEOWNERS`, or Dependabot. Secret scan hook exists
  (`scripts/hooks/secret-scan.mjs`); I grepped the tree for the shapes
  it knows and only hit test fixtures and the scanner itself.
- Branch protection API 403 from this token; could not verify required
  checks. Empirical fact: red `main` was pushed and stayed red.
- `bd` is not on this machine. Tracker protocol could not be run.
- Node on the default cloud image is 22.14.0, below the 22.18 floor.
  nvm 22.22.2 is present. A cloud agent that does not pin nvm will
  `EBADENGINE` on `npm ci`.

## Engineering practices that matter here

Not a generic lecture. These are the ones this repo's own commitments
make load-bearing.

**CLI errors.** Exit contract is real (`docs/exit-codes.md`,
`tests/cli/exit-codes.test.ts`): 0 / 1 / 2 only, plus EPIPE. Unknown
flags fail closed. Bare `work` / `skills` / `wire` no longer spend or
mutate (alpha.18). The two lies above — ambient "available", and "record
an outcome first" on an empty-map run — sit on top of that contract and
undo it for the engineer path.

**Package publish.** `.github/workflows/release.yml` is the right shape
for this package: OIDC trusted publishing, no `NPM_TOKEN`,
`npm publish --provenance --tag alpha`, tag must equal `package.json`
version, full gate before publish, npm 11.5.1 pinned only for the
publish client. `latest` staying on predecessor `2.1.1` is enforced by
the registry, not by a version number. I verified the tags. Do not
promote `latest` while the rewrite is this unfinished for an engineer.

**Tokens.** Connectors take env, not kernel config. Daemon spawn-discipline
test asserts `ANTHROPIC_API_KEY` and `CONSTRUCT_JIRA_API_TOKEN` do not
travel into the resident process. `.gitignore` refuses dotenv files.
Pre-commit secret scan is fail-closed. No live secrets found in the
tree. This part is sound.

**Test gating.** The gate line in README is true and I ran it:
lint (docs-vs-CLI verbs, glossary, bead-refs, connector import edges,
action SHA pins, figure re-derivation), typecheck, `node --test` over
229 files (52 cli / 121 kernel / 33 hosts / 14 scripts / 6 connectors),
plus packaged-install smoke. CI runs the suite twice (normal HOME and
read-only HOME) and smoke in parallel. Host probes
(`probe:opencode` etc.) are **not** in CI and need a real binary. That
is an honest gap: the spine is gated; "work actually returns a
deliverable on your host" is not.

**Not a monorepo.** One package. `files` is `bin`, `dist`, `skills`.
Kernel stays zero-dependency (`node:sqlite`). Host adapters sit behind
the seam. `scripts/lint-connector-gate.mjs` holds the use/build edge.
Boundaries are clear. The Engineer-seat hole is not a monorepo problem.

**License.** Apache-2.0 in `LICENSE`, `package.json`, and GitHub
`licenseInfo`. Public repo.

## Docs vs code (file evidence)

| Claim | Where | What is true |
|---|---|---|
| `npm install -g @geraldmaron/construct@alpha` | README, first-run | Works. I did it. |
| `construct doctor` then `doctor: healthy` | first-run | Works if Node ≥ 22.18. Hosts missing do not fail the exit. |
| Ten-minute walkthrough, every command run as written | first-run opening | Outcome works. `work` was not completable here. |
| 37 verbs | README | Published help has `init` and `status` extra. Main has `schedule` and `daemon` extra. |
| Engineer seat absent; host is the engineer | README seat table | Catalog is empty for engineering. Runtime still accepts the ask and mis-routes or denies the record. |
| Public docs at geraldmaron.github.io/construct | hypothesis only | 404. Docs are the repo markdown. |
| npm is `@geraldmaron/construct` | hypothesis | Confirmed. 64 versions. `latest` 2.1.1, `alpha` 3.0.0-alpha.18, provenance on the alpha tarball. |
| Main is alpha.18 | package.json | Version string yes. Tree has unreleased daemon/schedule since `32067b81` (the alpha.18 tag). |

## Well built / well thought out / competitive

Well built where the repo is about itself: sterile tests, packaged
smoke, docs-command lint, OIDC publish, honest withdrawn-claim writeup,
measured namer miss 0.280 / over 0.374 on out-of-family wording. I
re-derived those figures via `npm run lint` (`check:figures`). That is
more discipline than most agent tools show.

Well thought out as a personal outcome engine with portable skills. The
skills pack is in the tarball; smoke planted `investigative-research`
byte-for-byte. Seven skills, versions printed.

Not competitive as something a sharp engineer uses to do engineering.
The product tells them they are not the audience, then takes their
engineering sentence and staffs a measurement analyst because Node
printed the word `ExperimentalWarning`. The host that is supposed to be
the engineer cannot be reached from the command the tool just printed.

Competitors in this seat (the host itself: Cursor, Claude Code, Codex)
already do the engineering work. Construct's bet is coverage,
obligation, provenance around that work. On this machine that bet does
not complete: no deliverable, no inbox decision, no verdict to give.

## What would change the verdict

Not Phase 5 packets. These, observed:

1. `main` CI green. The daemon status test must not treat Node's sqlite
   warning as product stderr.
2. Doctor / outcome follow-up must not name a host `work` cannot spawn.
   "In-session execution: available" is false when `cursor-agent` is
   missing. Either dispatch in-session or say it is not available.
3. An engineering ask must not staff `measurement` because a Node
   warning contains `experiment`. Empty-map plus "this is host work"
   is the design. False seats are the hole.
4. `work` on a recorded outcome with zero tasks must not say the
   outcome was never recorded.
5. README start path short enough that an engineer hits `install` /
   `doctor` / `outcome` before the research paper. Verb table matching
   `construct help`. Published tarball matching the docs on the
   matching tag.

Until 1–4 are observed on the published alpha, I would not hand this
to a tester and ask them to trust it.

## Cross-references (engineering lens)

The lens's only job is tying symptoms to design decisions.

| Symptom observed | Design decision that explains it |
|---|---|
| No engineering role in `work` / `ask` | STRATEGY commitment: hosts are the engineers; lens `domains: []` is permanent. |
| `experiment` → measurement on a sqlite warning | Keyword fallback is the zero-model namer (STRATEGY risk 1 inversion; `domains.ts` lists `experiment`). |
| Ambient Cursor + failed `cursor-agent` spawn | Presence vs dispatch split in `hosts/ambient.ts`; callers print spawn commands anyway. |
| `latest` still 2.1.1 | Deliberate: rewrite publishes `--tag alpha` so predecessor installs do not move. |
| Docs site 404 | There is no Pages site. Homepage is the GitHub README. |
| CI red only after daemon residency landed | `construct-opp7` residency ladder (`docs/scheduled-operation.md`, RESEARCH-DECISIONS §29): asked-for daemon, socket protocol, status must be quiet. Status is not quiet on Node 22's sqlite warning. |
| Smoke green while `npm test` red | Smoke never asserts empty stderr on `daemon status`. The new unit test does. |

No design document I read acknowledges the `experiment`/`ExperimentalWarning`
collision or the ambient-available vs spawn-fail split as an open
defect. Those are symptoms the design does not name.
