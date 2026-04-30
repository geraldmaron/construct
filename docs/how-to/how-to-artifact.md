<!--
docs/how-to/how-to-artifact.md — How to generate and list structured artifacts.

Covers PRD, ADR, RFC, and memo generation via construct doc and init-docs,
plus verifying artifact stamps with construct doc verify.
-->

# How to Generate and List Artifacts

Construct produces four first-class artifact types: **PRD**, **ADR**, **RFC**, and **memo**.
Each has a template under `docs/templates/` and a dedicated lane under `docs/`.

## Stand up doc lanes for a new project

```bash
construct init-docs
```

Creates `docs/prd/`, `docs/adr/`, `docs/rfc/`, `docs/memos/`, `docs/runbooks/`, and `docs/how-to/`
with `README.md` indices and `_template.md` starters. Safe to run on an existing repo — will not
overwrite files that already exist.

## Generate a new artifact from a template

```bash
# copy the ADR template to a new file
cp docs/adr/_template.md docs/adr/adr-NNN-my-decision.md
```

Then fill in the template. Each template has a required frontmatter block with `status`, `date`,
and `deciders`. The `doc verify` command checks this block.

## Verify artifact stamps

```bash
construct doc verify docs/adr/adr-001-storage-backend.md
```

Confirms the file has a valid auditability stamp (hash, agent, task reference). Exits non-zero if
the stamp is missing or corrupted.

```bash
construct doc verify docs/
```

Recursively verifies all markdown files under `docs/`.

## List all artifacts by type

```bash
ls docs/prd/
ls docs/adr/
ls docs/rfc/
ls docs/memos/
```

No special command is needed — artifacts are plain markdown files in their lanes.

## Audit the mutation trail

```bash
construct audit trail
```

Shows every mutation logged by the system (agent, file, hash, timestamp). Useful for tracing which
agent created or last modified an artifact. Supports `--agent`, `--since`, `--verify`, and `--json`.

## Audit skill files

```bash
construct audit skills
```

Checks all skill files under `~/.claude/skills/` for stub headers, broken references, and missing content.
