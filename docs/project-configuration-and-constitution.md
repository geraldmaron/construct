# Project configuration and the constitution

Everything Construct knows about a project lives in the project.

## The layout

```text
.construct/
  project.json          identity and behavior configuration (committed)
  constitution.json     what the project is, what must not be violated (committed)
  sources.json          what it reads and what each source may settle (committed)
  registry.lock.json    the skill and workflow versions it resolved (committed)
  skills/               project-authored skills (optional)
  workflows/            project-authored workflows (optional)
  state/construct.sqlite  the only runtime database (ignored by Git)
```

There is no home database, no shared workspace, and no settings file. A
file from an earlier alpha is recognized by path or stamp, named exactly,
and never parsed; `construct reset` shows
what it would remove and removes only that when you confirm.

## Configuration precedence

Five tiers, lowest first: built-in default, per-user presentation defaults,
committed project config, environment variables, explicit flags. Each key
names which tiers may set it; a presentation key cannot be set by the
project, and a project-policy key cannot be set by the user file.

```bash
construct config list
construct config explain locale
construct config set review.cadence weekly
construct config get review.cadence
construct config unset review.cadence
construct config validate
construct config path
```

The keys and their tiers are in [config-reference.md](config-reference.md).
A committed file can never grant consent, carry a secret, name an
executable, or enable external writes; any key that would is refused with
the file and key named.

## The constitution

`constitution.json` is the committed, human-reviewed statement of the
project: name and purpose, scale, lifecycle stage, primary outcome, success
measures, principles, protected constraints and non-goals, canonical
artifacts, owners and decision rights, boundaries, risk posture, review
cadence, glossary, and known unknowns.

It holds only what a person accepted. Discovery proposes; proposals live in
state with their provenance until you confirm them in the host or answer the
onboarding questions, and the file is composed from confirmed material.

```bash
construct project show
construct project validate
construct project refresh
```

`refresh` re-reads the project's own files and proposes updates; it confirms
nothing. `status` names what is still missing from setup.
