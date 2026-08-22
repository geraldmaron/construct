# requirements-structuring — recorded run 1 (2026-08-21, Sonnet tier)

Run conditions: naked-file test, first dogfood run, and cross-tier floor
test in one. Sonnet-tier producing agent, skill file outside the repository
as its only method reference, repository forbidden, no web. The task was
real: the spec for this repository's skills projection subcommand (tracked
work the program needs). The deliverable below is verbatim as produced;
nothing was edited. The producer correctly labeled it a draft: its open
question 3 needs a research pass this run could not perform.

The one-line verdict for the use ledger: the questions-earned gate
surfaced a genuine undecided surface the requester had not noticed — the
briefing enumerated three subcommands but required uninstall as a
property, and the spec refused to invent the fourth command rather than
specifying around the gap. The reserved decisions (manifest-vs-inferred,
install-all) were honored as reserved; the default-directory assumption
was flagged as the spec's highest-leverage unknown instead of being
hard-coded; and every acceptance criterion is observation-shaped
(checksums, absence of writes, exit codes).

Producing model: Sonnet (same family as the skill's author; the
correlated-error caveat travels with any same-family judged reading).

---

# Skills projection command — spec (DRAFT)

**Outcome:** A developer using construct can list the portable skills shipped in the repo, install any one of them into a host's Agent Skills directory as an unmodified copy, and see an accurate, unfaked picture of what's currently installed and where — without construct ever writing to a host's skills directory except when explicitly told to install.

**Context:** construct ships seven method skills today, each a single `SKILL.md` file under `skills/` in the git repo, with frontmatter carrying at minimum a version field. This command is a second install path alongside the existing git-based `npx skills add` installer. Skill files stay out of the npm tarball (decided already), so the installed-package case cannot read them from disk and must fetch from git or fail honestly.

## Decided

- **Skills excluded from the npm tarball.** [decided — requester, recorded prior to this spec] The projection command must not assume local file access to `skills/` when construct is installed from npm; it operates against a checkout, or fetches from git, or errors.
- **`npx skills add` stays as-is.** [decided — requester] This new subcommand is an additional install path, not a replacement. It does not need to match that installer's UX, only coexist with it.

## Outcomes

1. `construct skills list` shows every skill in the source set (the repo's `skills/` directory, or the git ref it was fetched from) with its name and its frontmatter description, without requiring network access when run from a checkout.
2. `construct skills install <name>` places an exact, unmodified copy of that skill's `SKILL.md` into a host's skills directory.
3. `construct skills installed` shows, for each skill construct has installed, where it was installed and what version that installed copy actually is — derived from the installed file itself, not from the source repo's current state.
4. Uninstalling a previously-installed skill is possible and leaves no trace of it behind.
5. None of `list` or `installed` ever writes to, or otherwise touches, a host's skills directory; only `install` does, and only when run.

## Constraints

- Source `SKILL.md` files are the source of truth and are never modified by any part of this projection. [requester]
- Installed copies must be byte-identical to the source file — no reformatting, templating, or path rewriting. [requester]
- Version shown for an installed skill comes from that skill's own frontmatter metadata (the installed copy's, per Outcome 3), not a separate manifest's guess. [requester]
- Must function offline when run from a git checkout, and must function offline against an already-installed package's cached/fetched skill data; the case that requires network (installed-package, no local skill source yet) must fetch from git or fail with an honest, specific error — never silently no-op or fabricate a result. [requester; consequence of the npm-tarball-exclusion decision above]
- No command may write to a host's skills directory except `install`, and only in direct response to that explicit invocation. [requester]
- Uninstall must be possible and must leave the host's skills directory clean afterward — no orphaned files, no orphaned empty directories left by construct that weren't there before. [requester]

## Assumptions

- **[assumed]** "The standard location the Agent Skills ecosystem uses" resolves to one specific, well-defined default directory. This session has no web access to verify the current Agent Skills spec/convention, so no path is named here. What settles it: one research pass against the Agent Skills ecosystem's own documentation before the default is hard-coded (research-verification discipline applies). If it's wrong, `--dest` still allows correct manual installs, but the unqualified `install <name>` command will silently write to the wrong place for every user who doesn't pass `--dest` — this is the highest-leverage unknown in the spec.
- **[assumed]** Every one of the seven current `SKILL.md` files has a frontmatter field usable as "version" today. What settles it: inspect the seven files' frontmatter directly (cheap, done before implementation starts). If false, `list`/`installed` version display has nothing to show for at least one skill, and the acceptance criteria below need a defined behavior for that case (e.g., "unversioned," not a blank or a crash).
- **[assumed]** "A host's skills directory" means whichever Agent-Skills-compatible client's directory the operator points `--dest` at (or the default resolves to) — this command is host-agnostic, not wired to one specific client. If false and only one host is actually in scope, `--dest`'s design and the default-location assumption above both need revisiting.

## Non-goals

- **Modifying skill content during install** (templating, variable substitution, path rewriting) — excluded because the byte-identical-copy constraint makes this a contradiction, not a design choice.
- **Replacing the `npx skills add` installer** — excluded; that path is a decided keeper, this command is additive.
- **Installing from the npm tarball's own bundled files** — excluded; the tarball doesn't carry skill files by decision, so this was never in scope.
- **A general-purpose multi-host sync/watch mode** (keeping installed copies live-updated as the source changes) — excluded; nothing in the request asks for anything beyond a point-in-time copy, and "byte-identical, never touched again" argues against auto-sync entirely.

## Acceptance criteria

1. From a checkout with N `SKILL.md` files under `skills/`, `construct skills list` prints all N names, each with the description from that file's frontmatter, and completes with zero network requests observed.
2. `construct skills install <name>` (default destination) writes a file whose SHA-256 checksum equals the checksum of the source `skills/<name>/SKILL.md`, and the source file's checksum is unchanged afterward.
3. `construct skills install <name> --dest <dir>` writes the byte-identical copy into `<dir>` instead of the default, and does not also write to the default location.
4. Running `construct skills list` or `construct skills installed` on a machine where the host's skills directory does not yet exist does not create it and does not write any file under it.
5. `construct skills installed` lists, for each installed skill, an install path and a version string read from the installed copy's own frontmatter; if that installed file is hand-edited to a different version and the command is re-run, the reported version changes to match — it is never a cached or source-repo-derived value.
6. After uninstalling a given skill (mechanism TBD — see Open questions), `construct skills installed` no longer lists it, and no file or empty directory construct created for it remains under the host's skills directory.
7. Running `construct skills list` or `construct skills installed` from an npm-installed (non-checkout) construct, with no local skill source cached and network disabled, either succeeds using data construct has legitimately retained locally, or exits non-zero with a message stating skills must be fetched from git — it never reports success while silently doing nothing, and never presents stale data as current without saying so.
8. `construct skills install <does-not-exist>` exits non-zero, names the unrecognized skill in its error, and writes no file anywhere.

## Priorities

**Critical path** — the outcome is impossible without these:
- `list` (Outcome 1, AC 1)
- `install` to the default destination with a byte-identical copy (Outcome 2, AC 2, 4, 8)
- `installed` reporting the true on-disk state, not a cached claim (Outcome 3, AC 5) — this is the "never lying" property the requester named as the top priority

**Now** — needed for the spec to be usable as shipped, not deferrable:
- `--dest` override (AC 3)
- Honest offline/installed-package behavior (AC 7)

**Next** — needed for constraint compliance but has a design gap blocking it (see Open questions):
- Uninstall (Outcome 4, AC 6)

**Later** — explicitly out of this round by the requester's own hand:
- Resolving manifest-vs-inferred installed-state (implementation detail behind AC 5, not an observable behavior)
- Batch "install all skills" support

## Open questions

1. **Does `installed` state need a manifest file, or can it be inferred from what's on disk?** The requester named this explicitly as reserved to themselves. Blocks: the internal implementation of AC 5 and AC 6 (an uninstall that must "leave no trace" behaves differently if there's a manifest to also clean up versus pure directory-scan inference). Not blocking: the observable acceptance criteria above, which are written to hold either way. Answered by: requester.
2. **Should `install` support installing all skills at once?** Requester named this explicitly as reserved. Blocks: whether `install` takes multiple names or an `--all` flag in this version or a later one. Answered by: requester.
3. **What is the actual default install directory?** No web access in this session to verify the Agent Skills ecosystem's current convention (see Assumption 1). Blocks: the literal default-path constant in `install`'s implementation. Answered by: one bounded research pass against the Agent Skills spec/docs, before implementation of the default (not before the rest of the spec proceeds).
4. **What is the uninstall command's surface?** The requester enumerated three subcommands (`list`, `install`, `installed`) and separately stated uninstall as a required *property*, without naming a fourth subcommand or an alternative (e.g., manual removal since the install path is known and predictable). Blocks: AC 6's literal invocation syntax. Answered by: requester — this reads like it could be oversight or deliberate ("you already know the path, just delete it"), and guessing which would be specifying around an undecided decision rather than settling it.

---

## Verification record
- Separated:         answered — see "Decided" (2 entries), "Outcomes" (5), "Constraints" (6), "Assumptions" (3, each `[assumed]` with what settles it)
- Checkable:         answered — all 8 acceptance criteria pass the disagree-test (checksums, presence/absence of writes, exit codes, exact output changes on re-run); no invented numeric thresholds were needed for this spec
- Non-goals stated:  answered — see "Non-goals" (4 entries, each with a reason)
- Questions earned:  answered — 4 open, each named at "Open questions" with who answers and what it blocks; none of the four could have been settled by the author here (two are explicitly reserved by the requester, one needs external research access this session lacks, one is a genuine ambiguity in what was enumerated vs. what was required)
- Priorities honest: answered — see "Priorities"; critical path holds 3 of 9 tracked items, matching the requester's own stated top concern (byte-identical copies, never lying about installed state) rather than including everything
- Decision surfaced: answered — none hidden; the intent ("spec my skills projection command") named a concrete thing to build, not an undecided *whether*
