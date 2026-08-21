# Authoring a skill

Every skill in this directory is a product for a stranger's machine: one
self-contained file, pasted into any agent harness, on any model family, with
no construct checkout present. That is the naked-file test, and everything in
this checklist exists because a rule below, when broken, breaks that test
somewhere we cannot see.

The exemplar is [investigative-research/SKILL.md](investigative-research/SKILL.md).
Where a rule says "see the exemplar," that file demonstrates the rule in
shipped form.

## The five portability rules

**1. Six-field frontmatter, nothing else.** `name`, `description`, `license`,
`compatibility`, `metadata`, `allowed-tools` — the fields the Agent Skills
format defines. A vendor extension travels nowhere and is refused at upload by
stricter hosts. `allowed-tools` is deliberately absent from our skills: the
field grants and cannot restrict, so omitting it is the guardrail posture.
See the exemplar's frontmatter. *(Machine-checked.)*

**2. No host tool names, no vendor features.** Never "use WebSearch," "spawn a
subagent," "create an artifact" — the host that has those is one host among
many. Where a step needs a capability the environment may lack, write a
capability-honesty clause instead: say what to do when the capability is
present, and what to say and mark when it is not. See the exemplar §7,
"Capability honesty": no way to read public material means the claim is marked
`[unverified]`, never a narrated search that did not run.

**3. Enforcement by visible output shape, never by harness machinery.** Hooks,
linters, and validators exist on some hosts and not others; a skill that leans
on them silently loses its enforcement in transit. The skill's obligations are
made checkable by the reader instead: a closing record block the deliverable
must carry, each gate naming where in the document it was answered, a gate not
done stated rather than skipped. And the skill says so, in a short enforcement
statement near the end: nothing in this file is machine-enforced by this file;
an environment that adds a deterministic tier adds it on top. See the exemplar
§10 and §11. *(Presence machine-checked: a record heading and an enforcement
statement.)*

**4. Explicit templates over judgment-only guidance.** A capable model follows
"weigh the trade-offs honestly"; a weaker one produces contract-clean prose
that skipped the weighing. Wherever the skill's value turns on an output, the
skill carries that output's shape literally — exact markers, exact block
layouts, "exactly this shape" — so the floor across model families is the
template, not the model's judgment. See the exemplar §2 (three markers, used
exactly) and §10 (the record block, verbatim).

**5. A stand-down rule, stated in scope.** Every skill names when it must not
engage, and says that applying nothing is a designed outcome — because a
method that always interposes teaches the reader to ignore it, and because a
model that cannot judge stakes still needs a cheap, safe exit. See the
exemplar §1. *(Presence machine-checked.)*

## The section grammar

Skills share a skeleton so the library reads as one system:

1. **Scope, and when to stand down** — when the method engages, when it must not.
2. **The disciplines** — the method's working rules, with literal shapes.
3. **The closing gates** — what must be answered before anything is final.
4. **The record** — the output block that makes the gates checkable, verbatim.
5. **The enforcement statement** — what enforces this file, and what does not.
6. **References** — method identified, not incorporated; reading them is never
   required to follow the skill.

Length: under 500 lines, hard limit (machine-checked); 250–450 is the working
range. The description field is the trigger — write it as the conditions
under which a host should fire the skill, including the stand-down condition,
and test it against realistic prompts before shipping.

## Composition without coupling

Skills compose in a host by being co-installed, never by requiring each other.
A skill names its neighbors conditionally — "when the deliverable is prose for
a reader, the written-voice skill governs voice, if present" — and works
identically when the neighbor is absent. A skill that needs another skill to
function has failed the naked-file test by other means.

Composition also has an output rule, carried in every skill's record
section: when several skills govern one deliverable, the skill owning the
deliverable's shape produces its full record and every other skill
contributes one line to that same block - never a second full block. And
record pointers quote a fragment of what they point at, so presence-only
checking cannot be satisfied by a well-formed empty answer. Both exist
because the failure mode of well-behaved templates is compositional:
stacked ceremony burying content.

## Severability tripwires

Machine-checked, and worth knowing while writing: no tracker ids, no paths
into this repository, no absolute paths, no references to any person or
machine. Method that originated in this repo's source is rewritten into the
skill in plain language, never pointed at.

## Before it ships

- The extended skills lint is clean (`npm run lint`).
- The naked-file test: the single file, outside the repo, on a session with no
  construct context, produces the deliverable with its record intact.
- The description trigger-tested: prompts that should fire it do; a prompt
  that should stand down does.
- A pre-registered falsification test, named before first use: the claim, the
  instrument (a use-ledger line stating whether a gate changed the outcome),
  and what refutes it.
- One recorded real-work run, logged in the use ledger.
