<!--
docs/operations/backup-restore.md: Backup, restore, and machine migration for Construct.

Reflects the post-Postgres state model: durable state is the project git repo
plus Beads issues in Dolt; `.construct/` is machine-local and rebuildable; credentials
live in ~/.config/construct/config.env. `construct backup` (the old Postgres
dump/restore family) was removed with the SQL backend.
-->

# Backup and Restore

Construct no longer runs a database you have to dump. The old `construct backup create/verify/restore` family required a local Postgres backend, which was removed — running `construct backup` now just tells you so. Durable state is instead split three ways, and each part is protected by a mechanism you already use.

## Where durable state lives

| State | Location | How it is protected |
|---|---|---|
| Source, docs, `specialists/org`, `construct.config.json`, `AGENTS.md`, `.beads/` config + hooks | Your project git repo | `git commit` + `git push` |
| Beads issues (task graph, history) | Dolt (versioned), working copy at `.beads/construct.db` (gitignored) | `bd dolt push` to your Dolt remote |
| Machine credentials | `~/.config/construct/config.env` (mode `0600`) | Copy it somewhere safe, or resolve from 1Password (see below) |
| Observations, sessions, traces, intake, task-graph cache, the LanceDB vector index | `.construct/` (gitignored in full); vector index at `.construct/lancedb` or `~/.local/state/construct/vector/lancedb` | Machine-local and **rebuildable** — not backed up |

The first three are your backup. Push your repo, run `bd dolt push`, and keep `config.env` safe, and you can reconstruct a machine.

## Back up

Nothing Construct-specific runs here — you back Construct up the same way you back up any repo-based tool.

```bash
# 1. Versioned project state (source, docs, specialists, beads config)
git add -A && git commit -m "checkpoint" && git push

# 2. Beads issue data (versioned separately in Dolt)
bd dolt push

# 3. Machine credentials — copy the file, or rely on 1Password (next section)
cp ~/.config/construct/config.env /path/to/secure/backup/config.env
```

`config.env` is stored unencrypted and holds provider keys. Treat any copy with the same care as the original, and prefer a location that is itself encrypted.

### Credentials via 1Password (no plaintext to back up)

If `config.env` holds `op://` references instead of plaintext keys — for example `OPENROUTER_API_KEY=op://vault/item/credential` — then there is no secret to copy: the values re-resolve from 1Password on the new machine. Point Construct at your `op run` env-file with `CONSTRUCT_OP_ENV_FILE` and the keys are never written to disk in the clear. See [Plug in your own LLM → Resolve keys from 1Password](/guides/cookbook/plug-in-your-own-llm).

## What is *not* backed up (and why that is safe)

Everything under `.construct/` is machine-local and gitignored in full. It rebuilds:

- **LanceDB vector index** — re-embedded from your sources on demand; the embedding model re-downloads to `~/.cache/construct/embeddings/` (~22 MB, one time) on first use.
- **Sessions, traces, observations, intake** — local session history. Losing them loses history, not versioned artifacts.

Because the index is derived state, there is nothing to restore for it — it repopulates as Construct runs. Inspect the backend with `construct storage status`; clear it with `construct storage reset` if you want a clean rebuild.

## Restore / migrate to a new machine

```bash
# 1. Get your versioned state back
git clone <your-repo> && cd <your-repo>
npm install                      # postinstall stages .construct/ and .claude/

# 2. Machine setup (config, completions, LanceDB path, optional CLIs)
construct install --scope=user

# 3. Credentials — restore config.env, or set CONSTRUCT_OP_ENV_FILE for 1Password
cp /path/to/secure/backup/config.env ~/.config/construct/config.env

# 4. Beads issue history (from your Dolt remote)
bd dolt remote add origin <dolt-remote-url>   # only on a fresh checkout with no remote configured
bd dolt pull

# 5. Verify — the vector index re-embeds on use
construct doctor
```

`construct doctor` confirms config, the LanceDB backend, hooks, and integrations are healthy. The vector index is not restored from a backup; it rebuilds as you work.

## What changed from the Postgres era

- `construct backup create/verify/restore/purge` — **removed**. There is no Postgres dump to take. Running `construct backup` prints the current guidance.
- `DATABASE_URL` — carried through only if you set it (legacy passthrough); Construct's local retrieval no longer depends on it.
- Retrieval now rides on embedded LanceDB (384-dim `Xenova/all-MiniLM-L6-v2`), not Postgres + pgvector.
