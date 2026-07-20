---
intake: none
---

# Spike B — Decomposition & Assignment Record

Written by the lead **before** dispatch (timestamp below), so the assignment is provable as a
plan and not reverse-engineered from the workers' answers.

## Research question

> What are the actual current gaps between Construct's documented XDG Base Directory layout
> (`docs/guides/reference/config.md` lines 13–23) and its real implementation in code — per
> root (config/state/cache) and per the "clean break, no legacy migration" claim?

Chosen because: it is a real, narrowly-scoped claim already sitting in this repo's own docs
(`docs/guides/reference/config.md`), it names a single source-of-truth module
(`lib/config/xdg.mjs`), and it decomposes cleanly along the three XDG roots the doc itself
defines, plus one claim (no-migration) that cuts across all three. It is checkable purely by
reading source and running greps — no external systems, no ambiguity about "done."

Lead dispatch timestamp (UTC): 2026-07-18T00:13:29Z (see `date -u` capture in session; this
file is written immediately before the `Agent` tool calls that launch the four workers).

## Eligibility decision

Decomposable: **yes**. Each of the three XDG roots (config/state/cache) has its own doc-listed
file inventory (`config.md` lines 19–21) and its own set of consumer modules; a worker can
answer "does X actually resolve through `lib/config/xdg.mjs` at the documented root" for its
root without needing another worker's findings. The fourth question (legacy/migration claim) is
orthogonal — it asks whether *any* code path still touches the pre-XDG `~/.construct` tree,
which is a repo-wide grep independent of which of the three roots is implicated.

Not decomposable further usefully: splitting one root's file list across two workers would
create false independence — the resolver call site for `config.env` and `providers.json` is the
same handful of modules (`lib/env-config.mjs`, `lib/setup.mjs`), so splitting them would just
duplicate the read of those files. Four workers is the natural grain.

## Assignment (non-overlapping scopes)

| Worker | Owns | Primary doc claim under test | Must NOT check |
|---|---|---|---|
| W1-config | `$XDG_CONFIG_HOME` root | `config.md` line 19 file list + line 15 resolver claim | state/cache roots, legacy migration |
| W2-state | `$XDG_STATE_HOME` root | `config.md` line 20 file list | config/cache roots, legacy migration |
| W3-cache | `$XDG_CACHE_HOME` root | `config.md` line 21 file list + "regenerable transients" claim | config/state roots, legacy migration |
| W4-legacy | Clean-break/no-migration claim + `~/.cx/` | `config.md` line 23 ("no read or migration of a legacy `~/.construct/*` tree") + line 82 (`~/.cx/`) | the three XDG roots' file inventories |

All four may open `lib/config/xdg.mjs` and `docs/guides/reference/config.md` as shared
read-only reference material — that is expected and is not scope overlap (overlap would be two
workers independently producing findings about the *same* consumer file or the *same* doc
claim). Each worker was told explicitly not to investigate the other three rows.

## Independent-artifact convention

Each worker writes ONLY to `spikes/b-parallel-research/workers/<worker-id>.md` and returns
that same content as its final message, so the file is a true unedited copy of the raw output,
not a lead paraphrase.
