# The install path, walked as six users

Design instrument, not user research. These archetypes are authored
expectations used to find deficiencies in the install-to-first-value path.
Nothing here is a measured claim about any real user or population — the
no-external-subjects rule (STRATEGY, Phase 5) forbids that reading, and these
profiles are not personas in the retired role-prompting sense (RESEARCH-DECISIONS
§§14–15): they frame what a user would expect at each milestone, they do not
claim to make any model see differently.

The triggering incident: an agent inside an IBM Bob session was asked to
install Construct and use it. The install worked (globally — the
project-settings program covers the rest), and then the agent relayed a
dispatch command naming `--host=opencode`, a host the user was not in. The
user's stated expectation is the standard this document walks every archetype
against: *"If I tell an agent to install construct and point it at the
repository, that should be it. It should work after that within that session."*

## The milestones

Every archetype walks the same eleven milestones. A deficiency is a milestone
where the archetype's reasonable expectation and the shipped behavior diverge.

1. **Discover** — learn Construct exists and what it does
2. **Install** — get the binary reachable
3. **Verify** — know the install is healthy (`doctor`)
4. **Wire** — connect Construct to where the user actually works (MCP entry, host)
5. **Ground** — declare sources the work should be held to
6. **First outcome** — state the first outcome in their own words
7. **Dispatch** — the work actually runs, on a model, somewhere
8. **Read back** — see what was done in whose name (`log`, `show`)
9. **Decide** — resolve what the inbox raises
10. **Learn** — lessons, verdicts, the loop closing
11. **Maintain** — update, reconfigure, uninstall cleanly

## The archetypes

### A. The operator (north-star audience)
Non-technical. States outcomes, reads decisions. Never opens a terminal by
choice; everything is mediated by an agent or a surface someone else wired.
**Expectations:** milestones 1–5 are somebody else's job (usually an agent's);
6–9 are conversational; 10–11 invisible. **Sharpest expectation:** never being
handed a shell command.

### B. The agent-session resident (the incident's archetype)
Lives inside one agent host — Bob, Claude Code, Cursor, OpenCode. Tells the
session's agent to install and use Construct. The session *is* their computer.
**Expectations:** install happens in-session; the session that installed it is
the session that uses it; dispatch rides the model and subscription this
session already has; anything the agent relays back for them to run targets
*this* host, not another one. Reloading a window is an accepted norm; being
sent to a different tool is not.

### C. The terminal-first solo dev
The README's current happy path. Comfortable with `npm install -g`, runs
`doctor`, reads usage lines. **Expectations:** commands are discoverable,
flags predictable, errors name the fix, nothing runs that they didn't start.
Mostly served today; friction is choice-overload at milestone 4 (which host?)
and 7 (which flags?).

### D. The embedded-repo engineer
Wants Construct present *in a project*: settings that travel with the repo,
teammates get the same posture, state that doesn't bleed across projects.
**Expectations:** a committed file declares the repo's Construct posture; a
fresh clone plus one ratification works; nothing global is silently touched.
Met by the project-settings program (construct-berp, construct-lgnq,
construct-0sby), which has shipped: a committed `.construct/settings.json`
declares the repo's posture, stays inert until `construct trust --ratify`
ratifies its exact bytes, and `state: local` roots the store inside the repo
instead of under home. What stays global — the sqlite store's default home
location and standing consent — is touched by no checked-in file.

### E. The multi-client consultant
Runs client work in separated workspaces. Confidentiality is the operating
constraint, not a preference. **Expectations:** work never lands in the wrong
workspace by default (today the silent `default` workspace is exactly that
footgun — construct-lgnq's binding closes it); sensitive sources gate outward
writes; erasure means erased (construct-kr0s); the machine holds nothing
world-readable (construct-jwbq, construct-38k3).

### F. The automation context
Not a person: CI, a cron, a scripted pipeline invoking `construct` headless.
**Expectations:** `--json` output, stable exit codes, no interactive prompts
ever, no color unless asked (construct-iidh); every consent question fails
closed rather than hanging.

## The deficiency map

Milestones where an archetype's expectation and shipped behavior diverge.
Letters name archetypes; each row cites its bead once filed. Rows that have
since been closed by shipped behavior are marked **Closed** and kept in place,
so the walk still reads end to end and the record shows what moved.

| # | Milestone | Deficiency | Hits |
|---|---|---|---|
| 1 | Dispatch | **Closed — host self-detection ships.** Construct reads the marker a host sets on its own subprocesses (`CLAUDECODE`, `CURSOR_AGENT`, and peers, in `hosts/ambient.ts`), so `outcome`, `work`, and the relayed follow-up command default to the session the user is in and name OpenCode only when no host is detected. The incident's proximate cause, resolved. | A, B |
| 2 | Dispatch | **The projection cannot dispatch, by design.** An in-session agent must hand the human a shell command to run work at all — the thin-projection constraint (STRATEGY, Phase 2) colliding with the seamlessness expectation. Direction-grade: options and recommendation recorded on the program epic; the STRATEGY sentence is Gerald's to change. Still open. | A, B |
| 3 | Install | **Partly closed — project-scoped state ships; install-shape guidance does not.** `state: local` (opt-in, ratified) roots the store inside the repo, so state no longer bleeds across projects unasked. What remains: nothing yet tells the installing agent which install shape fits the session it is in, and `npm install -g` may still need a PATH or shell reload the agent does not anticipate. | B, C, D |
| 4 | Verify | **Closed — `doctor` names the host you are in.** An `ambient` line reports whether Construct was invoked from inside a host and whether in-session execution is available or projection-only, alongside the machine census — the one fact the agent-session resident needs, now stated plainly rather than inferred from a misrouted dispatch. | B |
| 5 | Wire | **Closed — `construct wire` auto-wires the ambient host.** Run inside a host, it detects which one and writes the `construct serve` entry into that host's MCP config (Claude Code and Cursor today), so the milestone no longer requires hand-editing a recipe. A host it has no writer for, or none detected, refuses and names the manual recipe rather than guessing. | A, B, D |
| 6 | Ground | **Partly closed — a committed posture file exists; source declarations are still per-session.** `.construct/settings.json` is now a committed, ratified statement of the repo's posture (host, locale, ground hints, `state`), so preferences travel with the repo. What remains: declared *sources* are still added one command at a time and are not themselves committed, and the silent `default` workspace is still the confidentiality footgun. | D, E |
| 7 | Read back | **The projection's read surface escapes unlike the terminal's.** Inbox positions reach the MCP projection unescaped (construct-ayva), so what an in-session agent reads back is not held to the same injection discipline as the CLI. | A, B |
| 8 | Decide | **An in-session decision cannot be told from a human one.** The MCP `decide`/`answer` tools record a resolution with no provenance, so a model-relayed decision satisfies the outward-write gate exactly as a human's does (construct-hleq, the lost P0) — the sharpest trust break for the consultant, where a forged decision could publish client work. | A, B, E |
| 9 | Maintain | **The machine keeps more than the user thinks, and less cleanly.** The store is world-readable (construct-jwbq), extracted client-document text is cached world-readable and uncleaned (construct-38k3), erasure leaves recoverable bytes (construct-kr0s), and updates surface only as a `doctor` pin line. | C, D, E |
| 10 | (cross-cut) | **The automation context has no machine surface.** No `--json`, unversioned exit-code contract, and consent questions that could hang rather than fail closed (construct-iidh) — milestones 7–9 are unreachable headless. | F |

## Program structure

This document is the design instrument; the work it implies lives in the
program epic **construct-INSTALL** (seamless install-to-first-value within the
host the user already works in) and its children. Of the two rows recorded as a
direction-grade decision with options in `RESEARCH-DECISIONS.md` §26, host
self-detection has since shipped (row 1); the projection-dispatch inversion (row
2) remains the open one, and the piece of §26 that edits the presence/execution
seam STRATEGY describes is flagged there for Gerald's ratification rather than
decided by a session. Every other row is ordinary execution behind the existing
gates, assigned to the epic's children.