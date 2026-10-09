# Release verification

An alpha is cut deliberately and published only under the `alpha` dist-tag;
`latest` stays on the predecessor until a `3.0.0` is promoted on purpose.

## The gate

```bash
npm run lint && npm run typecheck && npm test && npm run smoke
```

`lint` chains: no absolute paths, glossary parity, no tracker ids in code,
skill-spec and skill-policy conformance, terminal-escape safety, the docs
index, documentation commands against the command registry, documentation
bead references, lockfile version parity, the registry index check, and the
generated-reference check. `test` runs the sterile suite, including the
documentation examples, the scenario tests, the drift fixtures, and the
broker protocol. `smoke` packs the package, installs it into a scratch
project, and runs init, status, doctor, config, source add and refresh,
workflow run, run show, inbox, run cancel, serve over stdio, skill install
and verify, reset, and a refused retired command from packaged bytes under
an isolated home, and proves no per-user database appears.

## Cutting an alpha

1. Bump `package.json` and refresh the lockfile
   (`npm install --package-lock-only`).
2. Regenerate derived material: `npm run registry:index` and
   `npm run docs:generate`.
3. Update `CHANGELOG.md`.
4. Run the full gate on the bumped tree, and `npm run evals:live -- check --cut`,
   which passes only on a current, passing, full-scope live intake record.
5. Commit the scoped change with a plain-language invariant and no attribution
   trailers. Push only when authorized, open a pull request to `main`, and wait
   for its checks before merging. Confirm the merged commit's checks too.
6. Tag that verified `main` commit with `v` followed by the package version.
   Pushing the tag starts `.github/workflows/release.yml`: it repeats the gate
   and publishes through npm trusted publishing using
   `npm publish --provenance --tag alpha`. Do not publish from a different tree
   or move `latest`.
7. Confirm the workflow completed, npm's `alpha` tag names the new version,
   and `latest` is unchanged. Inspect and smoke-test the published package,
   not only a locally packed candidate.
8. Create a GitHub prerelease for the existing tag with accurate release notes,
   upgrade instructions, and remaining verification limits. Attach the verified
   npm tarball and its checksum. Keep the repository README, About text,
   changelog, and generated references consistent with the release.

Tagging, pushing, merging, and publishing require the person's authorization.
No GitHub Pages site is configured for this repository as of September 27,
2026; its public landing surface is the repository README and release pages.
An alpha that ships disabled adapter paths must not describe them as verified
live cross-tool capability.

## Live intake eval

Before merging model-facing changes to staging, and before tagging:
`npm run evals:live -- check` must pass; a full-scope record is required at
each alpha cut, and `npm run evals:live -- check --cut` checks for one. The
record names each host, its version, the model, and the hosts left
unmeasured. `check` passes a smoke or full record. It fails when
`skills/evals/intake-live.json` is absent or is a baseline-scope record,
when the corpus or the model-facing text changed since it was recorded, when
a gated cell is missing, or when a verdict fails. Claude Code and Codex are
always measured; only Cursor, VS Code, OpenCode, and Bob may be listed as
unmeasured.

The runs behind a record are a release step, run by hand outside any host
session, on subscriptions only. They have not been run yet; no record
exists, so `check` fails until the first one is made.

The corpus, `skills/evals/intake.json`, is committed, and the suite checks
every gold reading with classify_request's own validator. Two model families
labeled only its 48 cases from the typed-intake design work, which stay in
the tune split. The routing cases and the authored cases carry Claude's
labels alone, so `agreed` is false on them, and exact kind and
blocking-question agreement are scored only on agreed cases. Before the
first full record, run `node scripts/evals-live.mjs label --labeler=codex`,
widen each case's accept sets where Codex reads it differently, and set
`agreed` where the two families match on kind and deliverable kind. The
labels land in `.tmp-evals/labels/`; merging them is a hand edit, and it
changes the corpus digest, so it comes before the runs.

The smoke subset below makes a record `check` accepts: the two smoke cells,
each against the candidate and both baselines. The staging baseline is a
`git archive` of 79562bbc with this tree's `node_modules` linked in; the
alpha.25 baseline is the published tarball, extracted.

```bash
mkdir -p .tmp-evals/servers/alpha.25
git archive --prefix=staging-79562bbc/ 79562bbc | tar -x -C .tmp-evals/servers
ln -s "$PWD/node_modules" .tmp-evals/servers/staging-79562bbc/node_modules
npm pack @geraldmaron/construct@3.0.0-alpha.25 --pack-destination .tmp-evals/servers
tar -xzf .tmp-evals/servers/geraldmaron-construct-3.0.0-alpha.25.tgz -C .tmp-evals/servers/alpha.25 --strip-components=1
STAGING=.tmp-evals/servers/staging-79562bbc
ALPHA=.tmp-evals/servers/alpha.25

node scripts/evals-live.mjs preflight --host=claude-code
node scripts/evals-live.mjs preflight --host=codex
node scripts/evals-live.mjs run --host=claude-code --model=haiku --condition=crowded --split=test
node scripts/evals-live.mjs run --host=claude-code --model=haiku --condition=crowded --split=test --server=$STAGING --label=baseline:staging-79562bbc
node scripts/evals-live.mjs run --host=claude-code --model=haiku --condition=crowded --split=test --server=$ALPHA --label=baseline:alpha.25
node scripts/evals-live.mjs run --host=codex --model=gpt-6-astra --condition=default --split=test
node scripts/evals-live.mjs run --host=codex --model=gpt-6-astra --condition=default --split=test --server=$STAGING --label=baseline:staging-79562bbc
node scripts/evals-live.mjs run --host=codex --model=gpt-6-astra --condition=default --split=test --server=$ALPHA --label=baseline:alpha.25
node scripts/evals-live.mjs record --scope=smoke
npm run evals:live -- check
```

A full record needs every gated cell, each run the same three ways
(candidate, staging, alpha.25), three runs per test case:

- Claude Code on `haiku`, `sonnet`, and `opus`, each in `default`,
  `crowded`, `no-tool-search` (the crowded stubs with tool search off, the
  setting where Haiku sent a remember request to a competing stub),
  `fresh-init`, and `injected`.
- Codex on `gpt-6-astra` in `default`, `crowded`, `fresh-init`, and
  `injected`. Tool search is a Claude Code setting, so Codex has no
  `no-tool-search` cell.
- Cursor on `composer-2.5` in `default` and `crowded` when the person opts
  in, because its runs use the person's own quota.

This is the live-eval matrix plus the `fresh-init` and `injected`
conditions on Claude Code and Codex. Every candidate cell needs both
baseline cells for the same host, model, and condition, and every cell
holds exactly three runs of each test case; `check` names any cell that
does not. A run still invalid after its rerun leaves its case incomplete,
and an incomplete case keeps the verdict from passing. Then run
`node scripts/evals-live.mjs e2e --host=claude-code --model=sonnet`,
`node scripts/evals-live.mjs record --scope=full`, and
`npm run evals:live -- check --cut`. Baseline cells carry over from an
earlier record while the corpus is unchanged; candidate cells carry over
only while the model-facing text is unchanged too. When two batches hold
the same cell, `record` refuses and asks for `--batches`.

Cursor runs need `--allow-cursor-state`, the person's opt-in, because they
touch `~/.cursor`. Until `preflight --host=cursor` passes its isolation
checks (only Construct and the stubs are visible, and a wired tool the
allow list leaves out is denied), Cursor runs skip outward-act cases and
refuse the injected condition. Traces stay in `.tmp-evals/`, which git
ignores.

## Live host conformance

Automated CI is deterministic and credential-free. `npm run conformance`
checks every supported host without a credential: whether it is installed
here, whether `construct init` wires it and plants the operational skill
where it reads, that the host file names no machine path and starts the
server exactly as written, that Claude Code's hooks stay in its
machine-local settings, the MCP handshake, that every host reads
byte-identical instructions, tool list, and skill with the operating
contract in the first 512 characters, the typed intake (a wrong reading
comes back naming its field, a right one matches by its deliverable, and
the classify_request schema and description fit a host's budget), skill
loading on request, a managed workflow run to a final deliverable, decision
relay, and the limits of the headless surface. It prints a table and writes
`.tmp-conformance/report.json`.

Live calls into an installed host run only with `--live`, outside any host
session, with that host's credential present. Codex, Cursor, and OpenCode
need `--model=<model>`, and Cursor also `--allow-cursor-state`. A host that
is not installed, has no scripted prompt entry point (VS Code and Bob),
lacks a required model or opt-in, or would be nested is an explicit untested
result with the reason, never a pass. A live call that runs is passed or
failed by its exit status and reply, so a missing credential is a failure.
What was and was not exercised for a given version is recorded in the
changelog entry for that version.
