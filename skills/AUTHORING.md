# Authoring a skill

Skills in this directory are portable method packs for a stranger's agent
host. Each skill is a folder: `SKILL.md` plus optional `references/`,
`scripts/`, and `assets/`, conforming to the [Agent Skills](https://agentskills.io)
format. Three layers of rules apply; do not confuse them.

## Three layers (do not conflate)

**1. Agent Skills specification** - what hosts and upload gates enforce.

- Frontmatter fields only from the format: `name`, `description`, `license`,
  `compatibility`, `metadata`, `allowed-tools` (all optional except `name`
  and `description` in practice; we ship `license` and `metadata`).
- `name` equals the skill directory: lowercase letters, digits, hyphens;
  ≤64 characters.
- `description` ≤1024 characters (format cap).
- Progressive disclosure: catalog loads `name` + `description`; activation
  loads `SKILL.md`; files under `references/`, `scripts/`, `assets/` load
  only when the body points at them. Prefer `SKILL.md` under ~500 lines /
  ~10k characters; move long templates and examples into `references/`.
- Relative paths from the skill root, one level deep
  (`references/foo.md`), not nested chains.

These are format/portability requirements. Machine-checked where this repo
lints the shipped set.

**2. Construct quality policy** - what this project asks of method skills it
ships, beyond the format.

- No host tool names or vendor features ("use WebSearch", "spawn a
  subagent"). Capability-honesty instead: what to do when a capability is
  present, and what to say when it is not.
- Explicit templates over judgment-only guidance for load-bearing outputs.
- A stand-down rule in scope: when the method must not engage; applying
  nothing is a designed outcome.
- Skills compose by co-install, never by requiring each other. Name
  neighbors conditionally ("if present…").
- Optional closing checklists and verification-record *templates* may live
  in `references/` with a one-line pointer from `SKILL.md`. They are
  Construct method hygiene for checkable work - **not** Agent Skills
  format requirements, and not a mandatory ceremony every skill must paste
  into `SKILL.md`.
- Severability: no tracker ids, no paths into this repository, no absolute
  paths in skill bodies.

**3. Historical convention** - earlier house authoring treated a single
self-contained `SKILL.md`, a mandatory in-file verification record, and an
in-file enforcement statement as if they were Agent Skills rules. They
were Construct choices that conflated with the format. Progressive
disclosure and optional `references/` supersede the single-file dogma.
Record/enforcement blocks are optional Construct templates, not format
obligations.

## Progressive disclosure layout

```
skills/<name>/
  SKILL.md                 # method rules; prefer under ~500 lines / ~10k chars
  references/*.md          # long templates, record shapes, genre examples
  scripts/                 # optional executable helpers
  assets/                  # optional static resources
```

In `SKILL.md`, point at a reference with a relative link and say when to
read it (e.g. "when finalizing, use …"). The agent loads that file only
then. Keep method substance in `SKILL.md`; move verbatim skeletons, genre
examples, and long bibliographic lists to `references/`.

## Section grammar (Construct method skills)

A useful skeleton, not a format mandate:

1. **Scope, and when to stand down**
2. **The disciplines** - working rules, with pointers to templates
3. **Closing gates** - short checklist of what must be answered
4. **Pointer** - one line to `references/` for record shapes if used
5. **Sources** - brief in-file list, or a pointer to `references/sources.md`

`description` is the trigger: write the conditions under which a host
should fire the skill, including stand-down, and test against realistic
prompts.

## Composition without coupling

Skills compose by being co-installed. A skill that needs another skill to
function has failed severability. When several skills govern one
deliverable and a verification record is used: the skill owning the
deliverable's shape produces the full record; others contribute one line  - 
never stacked full blocks. Pointers that say "see <where>" quote a
fragment of the target.

`allowed-tools` is deliberately absent from our skills: the field grants
and cannot restrict, so omitting it is the guardrail posture.

## Severability tripwires

Machine-checked: no tracker ids, no paths into this repository, no absolute
paths. Not machine-checked: no references to any person or machine. Method
that originated in this repo is rewritten into the skill in plain language.

## Before it ships

- The skill-spec lint is clean (`npm run lint`) - Agent Skills fields and
  severability; Construct policy checks are documented separately where
  they remain.
- Naked-folder test: the skill directory (or at least `SKILL.md` plus any
  referenced files the run needs), outside the repo, on a session with no
  construct context, produces the deliverable.
- Description trigger-tested: prompts that should fire it do; a stand-down
  prompt does.
- A pre-registered falsification test and one recorded real-work run in
  the use ledger, for skills this project claims work.
