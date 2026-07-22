---
intake: none
---

Obsolete: retained as historical workspace-control-plane research; Construct 2.0 uses Worker Profiles, Workspace Presets, and `.construct/` — see docs/obsolete/legacy-surface-register.md.

<!--
  Spike D synthesis report (construct-b0nny.5.4, Wave 3 of construct-b0nny,
  directive §11 spike D). Disposable — not adopted into any production path
  unless a later bead explicitly does so.
-->

# Spike D — daily workplace loop validation

**Bead:** construct-b0nny.5.4 · **Wave:** construct-b0nny.5 (Wave 3) · **Directive:** §11 spike D
**Question:** does a daily "read strategy + objectives + GitHub + Jira + Slack/Confluence,
detect signals, check alignment, recommend, propose" loop actually supply missing TPM/PM
capacity, or is it busywork?

Everything referenced below lives under
`docs/notes/research/workspace-control-plane/spikes/d-daily-workplace-loop/`. No real
GitHub/Jira/Slack/Confluence API was called anywhere in this spike; every external effect
is a local, labeled simulation. No file outside that directory (and this report) was
touched, and nothing was committed or pushed.

## 1. The fixture

Path: `spikes/d-daily-workplace-loop/fixture/`. A fictional internal-tools product,
"Nimbus", invented only to give signals a coherent narrative — no real company, product,
or person.

| File | Stand-in for | Load-bearing content |
|---|---|---|
| `strategy.md` | Strategy doc | 3 pillars (time-to-value, enterprise SSO, reliability) + explicit non-goals (dark mode) |
| `objectives.json` | OKR tracker | OBJ-1 (healthy), **OBJ-2 (stale + overdue)**, OBJ-3 (at_risk, healthy tracking) |
| `directive.md` | Standing directive for the loop | Mission, scope, non-goals |
| `authority-policy.md` | Authority policy | Allowed / requires-approval / always-prohibited lists |
| `github-issues.json` | GitHub Issues | **GH-101 (stale, unowned, enterprise-blocker)**, GH-102/103 (noise), GH-104 (closed, healthy) |
| `jira-backlog.json` | Jira-style backlog | **PROJ-88 (not reconciled with a newer decision)**, PROJ-90 (noise), PROJ-95 (open scope-check, unactioned) |
| `slack-messages.json` | Slack + Confluence notes | **SLACK-501 (leadership scope decision)**, SLACK-502/504/CONF-601 (healthy context), SLACK-503/505 (social noise) |

All fixture JSON files carry `"_fixture": true` and a `"_note"` disclaiming any real
integration. Every date is anchored to `TODAY = 2026-07-17`. Full listings are in the
fixture files themselves; not reproduced here to keep this report shorter than the source.

## 2. The loop

Path: `spikes/d-daily-workplace-loop/loop/run-loop.mjs`. A single Node script, five
subcommands: `detect`, `request-approval`, `approve`, `apply`, `verify`. Deterministic and
rule-based by design — the goal of this spike is to prove the *shape* of the loop
(detect → normalize → align → filter → recommend → propose → gate → simulate → verify →
no-fabrication) with reproducible evidence, not to prove an LLM can do freeform judgment
over a fixture only this session has seen.

Raw run output lives in `spikes/d-daily-workplace-loop/runs/logs/01` through `07`. What
follows quotes and cites that output; it does not restate the whole JSON.

### 2.1 Signal detection (directive requirement)

`detect` (run 1, `runs/logs/01-detect.log`) found 4 meaningful signals from raw fixture
facts — no hand-authored "expected signal" list, just date/status/keyword logic run against
the JSON:

- **`SIG-STALE-OBJ-2`** — `fixture/objectives.json#OBJ-2`: status `"on_track"`, `last_updated`
  `2026-05-20` (58 days before `TODAY`), `target_date` `2026-06-30` (already passed).
- **`SIG-ISSUE-GH-101`** — `fixture/github-issues.json#GH-101`: `status: "open"`,
  `severity: "high"`, `last_activity: "2026-06-05"` (42 days stale), `assignee: null`.
- **`SIG-GAP-SLACK-501`** — `fixture/slack-messages.json#SLACK-501`: a 2026-07-12 leadership
  message containing the keyword "deprioritize", referencing `OBJ-2`, `PROJ-88`, `PROJ-95`,
  all three of which have `last_updated` dates earlier than the message.
- **`SIG-RISK-GH-101-unowned`** — same `GH-101`, flagged separately as a risk because it
  carries the `enterprise-blocker` label with `assignee: null`.

### 2.2 Normalization (directive requirement)

All four signals — despite coming from three different fixture schemas (OKR JSON, issue
JSON, Slack JSON) — were normalized into one shape:
`{ id, type, severity, summary, sources: [{file, ref}], alignment }`. See the full objects
in `runs/logs/01-detect.log` or `runs/proposals/PROP-1.json`. `sources` is what makes every
downstream claim traceable (§2.8).

### 2.3 Graph updates (directive requirement) — and a real limitation found

I read `lib/graph/cli.mjs`, `lib/graph/relational/*`, and `lib/state-root.mjs` before
deciding how to handle this. Finding, not assumption: `construct graph`'s relational store
(construct-b0nny.3) is seeded from this repo's own file/capability/workflow/test/embed
graph, and its sqlite file is resolved via `resolveStateDir()` in `lib/state-root.mjs` to a
path under the user's real `~/.construct` project state root — outside both directories
this spike is scoped to, and not a schema built for arbitrary business entities like a
Slack message or a Jira epic. Writing fixture nodes into the real store would have (a)
violated the file-boundary constraint on this spike and (b) misused a store meant for code
facts. I did not run any `construct graph build|update|reconcile` command against the real
repo.

Instead the loop writes its own local stand-in graph to
`runs/graph/relationship-graph.json` — **16 nodes, 16 edges** covering every objective,
issue, backlog item, and message, plus explicit `gap_touches` edges from the detected gap
signal to each of its implicated entities. The file's own `_note` field states this
limitation. This is itself a finding worth carrying forward: if a later bead wants Wave-3
loops to update the real graph, `construct graph` needs either a new adapter/seeder for
business-signal entities, or a way to point the relational store at an isolated project
root — neither exists today.

### 2.4 Strategy alignment (directive requirement)

Every meaningful signal was checked against `fixture/strategy.md`'s three pillars
(`checkAlignment()` in the script). Result, per `runs/logs/01-detect.log`:

- `SIG-STALE-OBJ-2` → **conflict**: `strategy.md` Pillar 2 (last reviewed 2026-06-01) still
  says "ship full SSO/SCIM"; the objective's own drift plus SLACK-501 means the written
  strategy is now stale relative to the actual decision.
- `SIG-ISSUE-GH-101` → **conflict**: Pillar 2 depends on SSO/SCIM working; this bug blocks it.
- `SIG-GAP-SLACK-501` → **conflict**: Slack, Jira, the objective, and the strategy doc
  disagree with each other about scope.
- `SIG-RISK-GH-101-unowned` → **conflict**: Pillar 2 calls the enterprise deals a priority;
  an unowned blocker contradicts that in practice.

### 2.5 Meaningful-change filtering (directive requirement)

`classifyNoise()` filtered 4 items to `noise_filtered_out` in `runs/logs/01-detect.log`
using only structural heuristics (no `refs` to a strategic entity + no decision/strategy
keyword, or low severity + no linked objective) — not a ground-truth flag baked into the
fixture:

- `SLACK-503` ("tacos... 🌮"), `SLACK-505` (parking-garage FYI) — no refs, no keywords.
- `GH-102` (email-footer typo), `GH-103` (dark-mode request) — low severity, unlinked to any
  objective, and `GH-103`/`PROJ-90` match `strategy.md`'s explicit non-goal ("dark mode... not
  a strategic priority").

Meanwhile `SLACK-502` (incident update, tracks `OBJ-3`) and `SLACK-504` (OBJ-1 on pace) were
**not** filtered as noise but also generated no action item — the loop distinguishes
"meaningful, healthy, no action" from "meaningful, needs action" from "noise", three buckets
rather than a binary signal/noise split.

### 2.6 Risk/gap detection (directive requirement)

`SIG-GAP-SLACK-501` is the flagship gap: a real, dated leadership decision
(`fixture/slack-messages.json#SLACK-501`, 2026-07-12) that never propagated into the systems
of record (`fixture/objectives.json#OBJ-2`, `fixture/jira-backlog.json#PROJ-88`/`#PROJ-95`).
`SIG-RISK-GH-101-unowned` is a second, independent risk (an enterprise-blocking bug with no
owner). Both are cited with exact source files/ids, not asserted from narrative.

### 2.7 Recommendation (directive requirement)

Five concrete recommendations were emitted (`runs/logs/01-detect.log`, `recommendation`
array) — update `OBJ-2`'s status, reconcile `PROJ-88`/`PROJ-95` against the Slack decision,
triage-and-assign `GH-101`, flag `strategy.md` Pillar 2 wording for the next planning
review, and explicitly *no* action on the four noise items or the three healthy objectives.

### 2.8 Artifact proposal (directive requirement)

`runs/proposals/PROP-1.json`, `status: "pending_approval"` throughout this spike (the loop
never flips that field itself). Contains a brief citing 6 sources
(`fixture/slack-messages.json#SLACK-501`, `#OBJ-2`, `#PROJ-88`, `#PROJ-95`, `#GH-101`,
`strategy.md Pillar 2`) and 4 `proposed_external_effects` (a Jira field update + comment on
`PROJ-88`, a comment-and-close on `PROJ-95`, a label+comment on `GH-101`, a status update on
`OBJ-2`) — drafted, not sent.

### 2.9 Approval before external mutation (directive requirement)

Proved by trying to skip it. `runs/logs/02-apply-refused-no-approval.log` shows `apply
--proposal PROP-1` throwing before any approval record exists:

> `Error: REFUSED: no approval record for PROP-1. This loop will not apply an unapproved proposal.`

Only after `request-approval` (`runs/logs/03-request-approval.log`, writes
`runs/approvals/request-PROP-1.json` with the proposal's sha256 hash) and `approve --by
"priya-nair (VP Product, simulated approval)"` (`runs/logs/04-approve.log`, writes
`runs/approvals/record-PROP-1.json`, `status: "approved"`) does `apply` succeed
(`runs/logs/05-apply.log`). `apply` re-hashes the current proposal and refuses on any
mismatch with the approval record's stored hash — an approval binds to one exact proposal
body, not just an id.

### 2.10 External effect (directive requirement)

`runs/external-effects/sent-PROP-1.json`: `"_simulated": true`, `"_note": "No real
GitHub/Jira/Slack/Confluence API was called..."`, `effects_sent` = the same 4 effects from
the proposal. This is the only place anything resembling an "external write" exists in this
spike, and it is a JSON file on local disk, not a network call.

### 2.11 Verification (directive requirement)

`runs/logs/06-verify.log` / `runs/verification/result-PROP-1.json`: hashes the proposal's
`proposed_external_effects` and the simulated log's `effects_sent` independently and
compares them —

> `"proposed_effects_hash": "d024b9...", "sent_effects_hash": "d024b9...", "result": "MATCH"`

### 2.12 Source-linked record (directive requirement)

Every signal's `sources` array and every proposal claim's `cites` array names an exact
fixture file and record id (e.g. `fixture/objectives.json#OBJ-2`,
`fixture/slack-messages.json#SLACK-501`). Nothing in §2.1–2.11 above is asserted without a
file+id next to it; the fingerprint and hash chain in §2.13 gives the same traceability to
the run-to-run state itself.

### 2.13 No fabricated activity when nothing changed — hard requirement

Fixture untouched between runs (sha256 of every fixture file taken right after run 2,
matches what run 1 fingerprinted — see `runs/logs/07-detect-second-run.log` output below and
the `sha256sum` listing captured in the same session). Second `detect` call
(`runs/logs/07-detect-second-run.log`), no arguments changed:

```json
{
  "run_kind": "detect",
  "result": "NOTHING_NEW",
  "as_of": "2026-07-17",
  "fingerprint": "44fe78ef729c128507d7d7e1656f6b08717835d8e4842f216a630ae8a644dd65",
  "message": "Fixture unchanged since previous run at 2026-07-17 (run #1). Re-confirming the same 4 signal(s) already on record; 0 new signals detected. No new proposal generated.",
  "previous_run": {
    "runNumber": 1,
    "lastRunAt": "2026-07-17",
    "signalIds": ["SIG-STALE-OBJ-2", "SIG-ISSUE-GH-101", "SIG-GAP-SLACK-501", "SIG-RISK-GH-101-unowned"]
  }
}
```

The fingerprint (`44fe78ef...`) is byte-identical to run 1's. `runs/proposals/` still
contains only `PROP-1.json` — confirmed by directly listing the directory after run 2; no
`PROP-2` was created. **Pass**: the loop did not fabricate new findings, a new proposal, or
new "activity" of any kind on a fixture it had already fully processed.

## 3. What the loop did NOT do (honesty check)

- It never called a real API; `_simulated`/`_fixture`/`_note` markers are present on every
  file that could be mistaken for a real integration.
- It never auto-applied anything; §2.9's refusal is real code behavior, not a described
  intention.
- It never wrote outside `spikes/d-daily-workplace-loop/` or this report file.
- The detection logic is deterministic rules over structured JSON, not an LLM reading free
  text — meaning this spike proves the *scaffolding* (normalize → align → filter → gate →
  simulate → verify → no-fabricate) works and is auditable, not that an agent can find
  contradictions in truly unstructured, ambiguous real Slack history. That gap is called out
  explicitly in §4.

## 4. Go/no-go verdict

**Conditional go on the scaffolding; no-go on "this alone supplies TPM/PM capacity."**

What this spike actually proves, with evidence, not aspiration:
- A daily loop *can* be built that reads heterogeneous local sources, normalizes them,
  checks them against a strategy doc, tells signal from noise, surfaces a real
  decision-propagation gap, proposes a concrete artifact, gates any external effect behind a
  logged and hash-bound approval, simulates the effect, verifies it matches, and — critically
  — does not fabricate activity on a second run over unchanged input. All twelve directive
  bullets have direct file/log evidence, not narrative.
- The hardest property in the list — no fabrication on a no-op run — passed cleanly and
  mechanically (fingerprint equality, identical signal-id set, no new proposal file), which
  is the property most likely to fail in a real deployment if a team ships this without
  state-tracking discipline.

Why this is not, by itself, "missing TPM/PM capacity":
- **The detection logic here is rule-based and fixture-shaped.** The four signals it found
  are ones I hand-designed into the fixture specifically so date math and keyword matching
  would catch them. A real workplace's Slack history, Jira comments, and GitHub threads are
  far less structured — recognizing "this VP's offhand comment quietly overrides that
  ticket's stated priority" in real, ambiguous prose is a materially harder problem than
  comparing two ISO date strings or matching the word "deprioritize". This spike validates
  the pipeline shape, not that language-level judgment at this reliability generalizes past
  a curated fixture.
- **Every "recommendation" here is a restatement of facts already sitting in the fixture,
  visible to any human who read all seven files in five minutes.** A real TPM's value is
  disproportionately in judgment calls the loop did not have to make here: which of several
  plausible reconciliations is right, whether GH-101 should be fixed or the deal
  renegotiated, how to phrase the ask to an SVP. Nothing in this run required that kind of
  judgment because the fixture was built to make the gap obvious.
- **`construct graph` integration is a known gap, not a proven capability** (§2.3) — the
  "graph updates" bullet was satisfied by a local stand-in specifically because the real
  tool doesn't yet model this kind of entity. Any future adoption bead needs to design that
  adapter, not assume it exists.

Recommendation for a future bead if this pattern is adopted: keep the deterministic
scaffolding (fingerprint-gated state, hash-bound approval records, cite-by-file discipline)
— it is real, auditable, and worth keeping. Do not claim it replaces TPM/PM judgment until a
version of this loop is run against real, messy, non-curated workplace data and still
produces a defensible, non-obvious recommendation a human TPM would have missed.
