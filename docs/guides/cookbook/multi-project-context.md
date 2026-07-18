---
title: Multi-project context — register, synthesize, contribute
description: "Register other repos and directories as context targets, search and synthesize across them with cited provenance, contribute governed issue proposals back to Jira, and keep model cost under control — end to end."
---

Construct can treat other projects — local checkouts and remote repos — as first-class context. Register them once, then search across them, synthesize cited answers, bind them to orchestration runs, and contribute analyzed work back to an external tracker. Every cross-project claim keeps a re-verifiable origin, and you control model cost end to end.

This guide walks the whole capability. It assumes you have run `construct init` in your project.

## 1. Register context targets

A **directory** target reads content — docs and code — in place (no network, no clone). A **corpus** target clones a remote repo into a machine-local cache under the state root (never your project tree).

```sh
# A local checkout — read its docs where they sit
construct sources add directory proj-app '{"path":"~/Developer/Projects/app/docs"}'

# A remote repo — cloned into ~/.construct/projects/<key>/context-repos/<id>/
construct sources add github proj-sdk '{"repo":"acme/sdk","content":{"mode":"corpus","ref":"main"}}'
construct sources sync proj-sdk          # clone on first run, incremental fetch after

# A tracker to contribute back to later
construct sources add jira jira-core '{"project":"CORE"}'

construct sources list                    # shows provider, content mode, cache freshness
construct sources validate                # rejects a directory path that doesn't exist
```

`construct doctor` now watches these: it flags a directory whose path was deleted and a corpus cache older than its TTL (with a `construct sources sync <id>` hint), using filesystem and env checks only — no outbound network.

## 2. Search across projects with provenance

Registered targets join the knowledge corpus — markdown docs AND code files. Code coverage means every file with a UTF-8 text extension (`.js`/`.mjs`/`.ts`/`.tsx`/`.jsx`/`.py`/`.go`/`.rs`/`.sh` plus config, data, and markup formats — the `UTF8_TEXT_EXTS` list in `lib/document-extract.mjs`), with vendored/build directories (`.git`, `node_modules`, `dist`, `build`, `vendor`, `.venv`, `__pycache__`) and binary files excluded. Every hit carries a structured `origin` — `{targetId, provider, projectKey, relPath, ref, kind}`, with code hits tagged `kind: 'code'` — so you can attribute and filter results.

```sh
construct knowledge search "auth strategy"                       # host + all registered projects
construct knowledge search "auth strategy" --projects=proj-app   # just one project
construct knowledge search "payment handler" --projects=all      # code files hit too, attributed per repo
```

An unknown project id is a hard error listing the known projects — never a silent empty result.

## 3. Query each repo's code map

`construct graph build-targets` derives a static import graph per registered target — one graph per repo, persisted under `.construct/graph/targets/<targetId>/` so it survives session restarts — and `construct graph query` scopes to it with the same `--projects` semantics as knowledge search.

```sh
construct graph build-targets                                    # one import graph per registered target
construct graph query file:src/app.mjs --projects=proj-app       # dependencies + dependents in one repo
construct graph query file:src/app.mjs --projects=all            # fan the query across every target graph
```

The code map covers JavaScript-family sources only (`.js`/`.mjs`/`.cjs`, resolved from relative import/export/require specifiers — `lib/graph/build-import-graph.mjs`); files in other languages are searchable in the knowledge corpus but do not appear in the import graph. Graph nodes carry the same `origin` attribution (`targetId`/`projectKey`/`kind: 'code'`) as knowledge-search hits.

## 4. Synthesize across projects

`construct synthesize` runs a map-reduce: a retrieval-only map pass extracts each project's most relevant content (attributed to `project:path`), and a single reduce pass answers your question with every cross-project claim cited to its origin.

```sh
construct synthesize --ask "summarize each project's docs" --projects=all --dry-run
construct synthesize --ask "how do these strategies converge" --projects=proj-app,proj-sdk --template strategy-comparison
```

`--dry-run` prints the fully assembled per-project context, the citation table, and the reduce prompt with **no model call** — a deterministic preview you can inspect before spending tokens.

## 5. Bind context to an orchestration run

Point a run at specific projects. Ids are validated at plan time (unknown → hard error before any task is built); the resolved bindings are recorded on the run.

```sh
construct orchestrate run "align the roadmaps" --context=proj-app,proj-sdk,jira-core:tracker
```

The same binding is available on the MCP `orchestration_run` tool via `context_targets`, and on `author_artifact` — an authored artifact can draw on and cite each bound project.

## 6. Contribute governed issue proposals back to Jira

Analyze your registered projects against a tracker and propose new issues — evidence-cited, deduped against existing issues, and never written without approval.

```sh
construct tracker contribute --target jira-core --against proj-app,proj-sdk
#  → a proposal artifact: N proposed issues (each citing project:path), plus a dedupe report

construct tracker contribute --apply <proposal-id>                    # dry-run: renders payloads, writes nothing
construct tracker contribute --apply <proposal-id> --approve <token>  # governed write batch
```

Dry-run is the default and only path without a token. Re-applying the same proposal is idempotent — it creates no duplicates. Beads (`bd`) stay your internal tracker; this pipeline only proposes to the external one.

## 7. Control model cost

None of the above needs a frontier model. Set a policy once:

```sh
construct models policy set budget     # rank by live pricing, exclude frontier ids
construct models policy set free        # only :free slugs
construct models policy show            # the effective per-tier resolution + why
```

Cross-project synthesis and tracker analysis run their map passes on the fast/standard tier by default — the deterministic dry-runs cost nothing at all.

## Where the state lives

- Registered targets: `sources.targets[]` in your project config.
- Corpus caches: `~/.construct/projects/<key>/context-repos/<targetId>/` (state root, never your repo). See [Knowledge layout](/concepts/knowledge-layout) and [Project scopes](/concepts/project-scopes).
- Proposal artifacts: `.construct/tracker/proposals/<id>.{json,md}` (local runtime state).
