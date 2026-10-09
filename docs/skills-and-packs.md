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

`bootstrap` reports only how many skills and workflows the project has and
which are out of step with the lock. `classify_request` returns the
workflows whose deliverable fits the host's reading and the use-when line of
each skill they bind, unranked (every method skill and pack when the best
fit is `managed-outcome` and the reading names no skill). The host model
judges which method fits and names it as `skill` in its reading; Construct
does not pick for it. A workflow step binds its own skill by id and version
range, and the run keeps the version and digest it bound. `claim_work` names
the step's skill and returns its full text only with `includeSkillBody`; a
judgment step that binds no skill is told to load the method the reading
chose. A host session gets a skill's text only when it asks for it, and
never the whole library.

The `skills` tool lists the project's skills with their activation and
stand-down conditions, shows one with its digest, files, and qualification
(its full text only with `includeBody`), and with `status` reports each
bundle's lock state.

## On disk in a host

```bash
construct skill list
construct skill show intake
construct skill install intake --dir=./.tmp-skills
construct skill verify --dir=./.tmp-skills
construct skill remove intake --dir=./.tmp-skills --confirm
```

`init` plants only the operational skill, in the project skills directory
each wired host reads (`.claude/skills`, `.agents/skills`, or `.bob/skills`).
`init --skills-dir=<path>` also plants a personal copy in that directory,
which loads in every repository the host opens. Run inside Claude Code,
Cursor, or Bob, `construct doctor` names the `construct skill remove`
command for an older or changed copy in that host's personal skills
directory.

Install others by name when a host needs files on disk: `--dir` names the
directory, `--client=<claude|bob|opencode|cursor|codex|vscode>` names that
host's personal skills directory under your home (a copy there loads in every
repository the host opens), and with neither, the personal directory of the
host you are running inside is used when Construct can tell which one that
is (Claude Code, Cursor, or Bob); elsewhere the command asks for one of the
two. `verify` compares installed copies with the shipped bytes. A copy is
current, absent, outdated (this package's own earlier release of the skill,
which `init` and `install` replace), or diverged (a copy someone changed, or
one this package did not ship, which only `install --force` overwrites).

## Versions, digests, and the lock

Every bundle has a semantic version and a deterministic digest over its
files. `registry/index.json` ships the built-in catalog; a project pins what
it resolved in `.construct/registry.lock.json`.

```bash
construct skill update --dry-run
construct skill update
```

`update` reports current, outdated, diverged, missing, unlocked, and blocked
(locked at a later version than the one present) bundles and brings the lock
up to date; a project-authored bundle whose content
changed is left alone until you name it with `--confirm=<id>`. `status` and
`doctor` report skew. A built-in bundle whose content changes without a
version bump fails the release check.

## Qualification and skill impact

The `skills` tool's `show` action reports a skill's qualification:
`qualified` when the lock matches its digest and it carries evals for both
activation (`evals/activation.json`) and behavior (`evals/behavior.json` or
`evals/fixtures.json`); `experimental` when it is not locked or its evals do
not cover both yet; `degraded` when its lock is outdated or blocked; and
`unsafe` when the same version's bytes differ from the lock or its text
tries to raise Construct's authority. A locked skill that is no longer
present cannot be shown; the `status` action reports it as `missing`. A
quality claim follows the content digest, so the same version with different
bytes does not inherit it. The checks a skill must pass before release are
in [authoring-and-qualification.md](authoring-and-qualification.md).

```bash
construct skill impact
construct skill impact --skill=intake
```

`skill impact` (and `project_context` topic `quality`) reports, per skill
version, how often its steps passed their checks first time, mean
attempts, waivers, and which checks sent them back.
