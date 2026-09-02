# Skills and professional packs

A skill is a portable `SKILL.md` (Agent Skills format) beside a Construct
manifest, `construct.skill.json`, that declares what the portable file
cannot: activation and stand-down conditions, interaction classes, outcomes
and deliverable types, required inputs and sources, capability requirements
(never tool names), action tiers, versioned dependencies, quality gates,
escalation, licensed-review boundaries, observations, and evals. The
manifest and the frontmatter must agree on name and version.

## What ships

Seven method skills carry shared technique: intake, context mapping,
investigative research, decision framing, requirements structuring, written
voice, adversarial review. Nine professional packs carry doctrine with
obligations: software engineering, system architecture, product management,
experience design, program delivery, operations and reliability, security
and privacy, strategy and research, governance and risk. The operational
`construct` skill teaches the host how to use all of it. The catalog with
versions is [catalog.md](catalog.md).

A pack is not a persona. It is the obligations a deliverable must carry,
the doctrine it rests on with cited sources and review dates, a procedure,
templates, deterministic checks, fixtures, and explicit limits. No pack
claims expertise because of its name, every pack says what it may not
invent, and licensed judgments are prepared for a qualified person and never
given.

## Loading is progressive

Registry metadata is cheap and available at bootstrap. A skill's text loads
only when a step selects it, and its references, templates, and scripts load
only when the step needs them. The host never receives the library.

## On disk in a host

```bash
construct skill list
construct skill show intake
construct skill install intake --dir=./.tmp-skills
construct skill verify --dir=./.tmp-skills
construct skill remove intake --dir=./.tmp-skills --confirm
```

`init` plants only the operational skill. Install others by name when a
host needs files on disk; `verify` compares installed copies with the shipped
bytes.

## Versions, digests, and the lock

Every bundle has a semantic version and a deterministic digest over its
files. `registry/index.json` ships the built-in catalog; a project pins what
it resolved in `.construct/registry.lock.json`.

```bash
construct skill update --dry-run
construct skill update
```

`update` reports current, outdated, diverged, missing, and unlocked bundles
and brings the lock up to date; a project-authored bundle whose content
changed is left alone until you name it with `--confirm=<id>`. `status` and
`doctor` report skew. A built-in bundle whose content changes without a
version bump fails the release check.
