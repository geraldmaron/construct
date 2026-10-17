# Skills and professional packs

[Documentation index](README.md) · [Project README](../README.md)

A skill is a portable `SKILL.md` (Agent Skills format) beside a Construct
manifest, `construct.skill.json`, that declares only what Construct
enforces when it binds the skill into a workflow step: capability
requirements (never tool names), the highest action tier it may be applied
at, the validators its deliverable must pass, versioned dependencies, and
evals. Everything else about the method lives in `SKILL.md`. The manifest
and the frontmatter must agree on name and version.

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
fit is `guided-outcome` and the reading names no skill). The host model
judges which method fits and names it as `skill` in its reading; Construct
does not pick for it. A workflow step binds its own skill by id and version
range, and the run keeps the version and digest it bound. `claim_work` names
the step's skill and returns its full text by default (`includeSkillBody=false`
requests metadata only); a
judgment step that binds no skill is told to load the method the reading
chose. A claim supplies the current step's bound method, not the whole library.

The `skills` tool lists the project's skills with their descriptions,
shows one with its digest, files, and lock state (its full text only
with `includeBody`), and with `status` reports each
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
which loads in every repository the host opens. `construct doctor` fails on
an older or changed personal copy of the operational skill, in any host's
personal skills directory, and names the `construct skill remove` command.
Personal copies of the method skills are not Construct's to keep current:
another tool may own them (ai-workflow-config, for example), and Construct's
runs take a method's text from the registry, never from a personal
directory.

Install others by name when a host needs files on disk: `--dir` names the
directory, `--client=<claude|bob|opencode|cursor|codex|vscode|hermes>` names that
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

## Evals and skill impact

Each skill ships `evals/evals.json` and `evals/trigger-queries.json` in the
Agent Skills shape; [authoring](authoring-and-qualification.md#evals) says
how they are written and run. The `skills` tool's show action reports lock
integrity only: whether the bytes are the ones the project locked. It never
grants permission or claims a skill works; a run of its evals shows that.

```bash
construct skill impact
construct skill impact --skill=intake
```

`skill impact` (and `project_context` topic `quality`) reports, per skill
version, how often its steps passed their checks first time, mean
attempts, waivers, and which checks sent them back.
