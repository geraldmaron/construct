# Research decisions

The decisions that govern Construct as it is now, each with the date it was
made, the strongest objection raised against it, the best alternative, and
the verdict. It stands beside `STRATEGY.md` (the settled direction and its
commitments) and `GLOSSARY.md` (vocabulary). The pages in `docs/` describe
behavior; this record says why the behavior is what it is.

A decision that was reversed or superseded is removed rather than kept
beside its replacement. Git history holds the earlier record. Where a later
decision narrows an earlier one, the earlier entry here already states the
narrowed rule.

---

## 1. Construct is a project-bound layer, never a second runtime (2026-09-02)

Gerald's directive of 2026-09-02 defined the product: a project-bound,
capability-aware operating layer for agent hosts. The host owns model
execution and its sandbox. Construct owns context admission, bounded work,
execution bindings, evidence, and trust transitions.

**Host-pull, not server-push (2026-08-25, 2026-08-26).** Work runs in the
host the person is already in. That host's agent loop claims a step through
a Construct tool, does the work on its own capacity, and submits the result.
Construct never starts an agent turn of its own because a host was helpful,
and never forks the CLI of the host it is running inside. MCP sampling was
rejected as the mechanism: the 2026-07-28 MCP specification deprecates it
(SEP-2577) and limits server-to-client requests to the time a client request
is being processed, so the protocol itself has the host initiate. Completion
stays with the kernel: a host submits work and cannot mark its own work
accepted.

**Rules that came with the definition and still hold.**
1. Ownership is never inferred into fact. Reporting lines, membership, and
   ownership from any source stay proposed until a person confirms them.
2. A remember is a Construct state write, not a project write. The policy
   `policy.projectWrite: never` forbids writes to project files inside
   managed outcomes; it does not stop the person from asking Construct to
   remember something.
3. A blocked run never holds the door. Overlap and single-concurrency checks
   ignore blocked runs, and a firing that resolves supersedes them.
4. Construct reads only directories itself. Every other source is read
   through the host's own tools in a session or reported unreachable;
   nothing fabricates a snapshot.
5. Doctrine a method cites is opened before a finding leans on it. A
   skill's sources file says which entries were read and which were only
   identified.

**Challenge.** Strongest failure mode: a host that cannot call tools well
gets nothing done, where a Construct-side runtime could have done the work.
Best alternative: keep a spawn adapter per host. Rejected: it spends the
person's money as a side effect, duplicates what every host already does,
and makes Construct a runtime it was defined not to be. Verdict:
**accepted**.

## 2. Development model calls come from subscriptions (2026-09-01)

Probes, harness runs, trials, and measurement that build or verify
Construct run on Gerald's subscription-backed hosts. They do not run on a
local model server or a free hosted model. A person using Construct may
still choose a local model; this rule governs development only.

**Challenge.** Strongest failure mode: Construct is never measured on the
local models some users will choose. Best alternative: add local models to
the development matrix. Rejected: development quality is judged on the
models the maintainer works with, and a local model run on this machine
says little about another person's setup. Verdict: **accepted**.

## 3. The host reports the reading; real hosts are the gate (2026-10-08)

**Question.** Construct used to read intent from the person's words with a
regex classifier, an answer-to-work upgrade rule, and lexical floors over
skill descriptions. On 2026-10-08 Gerald approved replacing all of it with a
typed reading the host model reports through tool arguments.

**Decision.**
1. `classify_request` takes a closed typed reading. `kind` and `words` are
   required, and for work so is a deliverable (a declared kind, or `other`
   with a description) and `stakes`. It also takes a period, the named
   systems, a destination, a schedule, and open questions. Bad input returns
   a tool error naming the field, the allowed values, and a field-level
   example.
2. `start_outcome` re-validates the reading, so skipping `classify_request`
   skips no check. It creates no run while a required detail or a blocking
   question is open.
3. The reading is frozen once in the run's bindings: the person's period
   form, the resolved window, the named and registered sources, the stakes,
   the chosen method, and who judged it.
4. Rigor has one judge. The workflow's structure sets the floor (its
   challenge flag, step tiers, open contradictions). Host-reported stakes
   only raise it. Only the person's side-project answer makes work light.
5. The host model chooses the skill. `classify_request` returns the
   candidate skills with each one's use-when sentence, and the host reads
   them; Construct does not pick one or load it.
6. A citation passes only when Construct holds what it names, counted as
   witnessed, reported, or unverified. Systems the person named can be
   declared from the session and are kept on this machine as confidential.
7. A period is checked against what is cited. Only an item dated after the
   window ends is refused; items dated before it, or undated, are shown to
   the person.
8. Rule-outs, replacements, and outdated documents take effect only on the
   person's own channel.

**Measured before the decision.** On 48 messages written to probe phrasing,
the earlier regex got 20 kinds right and called 26 of 34 work items a
question. Sonnet and Opus, each reading the messages against a typed
schema, got 47 right with no false engagement. A model reading only the
shipped skill descriptions chose the right skill 73 of 74 times, against 14
of 68 top-1 for the lexical proxy. These measure reading a schema, not a
host deciding on its own to call a tool.

**The gate.** Changes to model-facing text are gated by live runs through
real hosts, one request per call, against a fresh project wired to the
Construct under test, with a tap recording every call. Cases are labeled
before any test-split run, split by hash into tune and test, and each runs
three times. Three axes are compared per host and model against
preregistered baselines: missed work, false write engagement, and writes
taken from injected text. The harness and its record are maintainer-local
(decision 17).

**Challenge.** Strongest failure mode: with no text matching left, the only
signal is the host model choosing to call a richer tool, and a skipped call
cannot be seen. Best alternative: keep `classify_request` text-only and
remove only the lexical veto. Rejected: the kernel would hold no typed
reading to validate and two judges in every response. Verdict: **accepted
with controls**: the live gate on missed work, a small required core,
re-validation on write, errors the model can act on, raise-only stakes, and
a short contract at the start of the server instructions.

## 4. A platform timer may fire a standing trigger (2026-10-17)

A saved standing trigger does not run after the session exits.
`construct workflow install-timer` installs a launchd or systemd user timer
that starts one short-lived firing of `workflow fire` and exits. Nothing
stays resident between firings, and catch-up after sleep belongs to the OS.
Host schedulers (Claude Code scheduled tasks, Codex automations, Cursor
automations) stay valid clocks, but none can hand Construct its due-slot
key.

**Challenge.** Strongest failure mode: a test, a worktree, or a second
checkout installs a second timer against the same store, or a firing fails
silently every week. Controls, each tested:
- Only the explicit command installs or removes a unit; init, library code,
  and the test harness cannot reach it, and tests assert the unit is written
  under the injected paths.
- One unit per trigger, named by project identity and trigger id, so a
  repeat install replaces rather than duplicates; `workflow timers` and
  `doctor` list installed units and flag orphans.
- The firing key is the due schedule slot, not the wall clock, so a late
  firing covers its window and a repeat is deduplicated.
- No secret in the unit or its environment; an unauthenticated host records
  a blocked run with the reason.
- Without an explicit executor the command refuses to install.
- macOS uses `StartCalendarInterval`, Linux `OnCalendar` with
  `Persistent=true`; a cron expression launchd cannot express exactly is
  refused.

Best alternative: no timer, and point people at their host's scheduler.
Rejected as the only path, because a host scheduler cannot hand Construct a
due-slot key. Verdict: **accepted with controls**.

**Still closed.** An on-demand resident process for sub-interval watches,
and a supervised always-on service, are not licensed. Either needs its own
dated decision.

## 5. Hermes Agent is a host, never the substrate (2026-10-17)

Hermes Agent (v0.22.2, read 2026-10-17) reads MCP servers only from
`config.yaml` under `HERMES_HOME`, gives its MCP children a stripped
environment, and asks before every tool call to a server marked
`trust: untrusted`.

**Decision.** `init --client=hermes` writes one `mcp_servers.construct`
block, naming the project by `--project=` and `cwd` and marking the server
untrusted. A narrow YAML block writer edits only that block, keeps an
unchanged file byte-identical, and refuses forms it cannot read. Hermes's
own skills, memory, and model-judged approvals stay Hermes's; nothing
Construct records comes from them.

**Challenge.** Strongest failure mode: Construct writes a file in the
person's home, so a bad edit corrupts a hand-kept YAML file, a second
project takes over the first one's binding, or a test reaches the real
home. Controls: the wiring entry points require the environment as an
argument, so a caller that forgets it fails to compile; the writer refuses
tabs, several documents, inline servers, anchors, and nested settings; an
entry bound to another project is refused with the `HERMES_HOME` remedy.
Best alternative: print `hermes mcp add` and write nothing. Rejected: that
command does not document `cwd` or `trust`, so the approval gate could not
be set. Verdict: **accepted with controls**. Running Hermes's always-on
gateway is a person's choice and stays outside decision 4.

## 6. Nothing in Construct matches a person's words (2026-10-17)

Trigger phrases lived in five places per skill and a sixth per workflow,
and almost none of it decided anything. The one runtime reader, a lexical
rigor floor, missed plain paraphrase and fired on unrelated senses of its
terms.

**Decision.** Construct keeps no trigger vocabulary. Skill manifests refuse
`activation` and `standDown`, so the vocabulary cannot grow back. The
router, its fixtures and floors, and the lexical rigor floor are gone. The
consequence judgment reads structure (challenge flag, step tiers,
contradictions) and the stakes the host reports, which a managed reading
must carry.

**Kept.** `SKILL.md` descriptions keep a few examples of how people ask,
read by the host model as the Agent Skills format intends and never
matched. The intake check that a system the host says the person named
appears in their words stays; it validates the host's reading, is labeled,
and never blocks. The authority-override and forbids-invention checks read
authored skill text, not the person.

**Challenge.** Strongest failure mode: a host reports low stakes on
hard-to-reverse work inside the project and gets standard rigor where the
floor would have challenged it. Controls: outward, destructive, and
licensed steps still raise rigor by tier; the person alone accepts a
deliverable; the stakes are shown in the judgment. Best alternative: keep
the floor as a fallback when stakes are absent. Rejected: it keeps the same
fragile vocabulary on the path where nothing checks it. Verdict:
**accepted with controls**.

## 7. A skill manifest declares only what something enforces (2026-10-17)

**Decision.** `construct.skill.json` carries id, title, version, category,
owner, capabilities, and skill dependencies, plus two declarations the
resolver enforces:
- `maxTier`, a ceiling: a step above it does not resolve.
- `requiredValidators`: each must be named on the step that binds the
  skill, or on a step whose inputs read that step's output, directly or
  through another such step. A check on unrelated earlier work, or on a
  step that only waits on it, does not count.

Every other key is refused with the allowed list. Rules that used to be
prose fields (escalations, licensed boundaries, evidence bars) live in each
`SKILL.md` body.

**Challenge.** Strongest failure mode: raising a skill's ceiling to fit a
workflow legalizes drift instead of catching it. The ceilings raised to
`project_write` match reviewed workflows that write a project document, and
the ceiling still stops any step from applying a skill outward or
destructively. Best alternative: keep the fields and add a reader for each.
Rejected: deliverable types had no consistent target and the prose fields
restated the body. An independent review found four defects in the
validator rule, each fixed with a test. Verdict: **accepted with
controls**.

## 8. Lock integrity, committed wiring, and what stays on its merits (2026-10-17)

From the clean-state audit of 2026-10-17, the calls that still govern:

**Lock integrity replaces a qualification ladder.** A skill is checked
against the bytes its lock pins; there is no per-skill qualification tier.
The earlier ladder needed a run only one host could produce and was read
only by a display, while the tier ceiling is the real boundary. Verdict:
accepted.

**This repository wires Construct from every checkout.** A committed
`.mcp.json` and `.claude/settings.json` start each checkout's own
`bin/construct.mjs`, so a fresh worktree gets Construct. Failure mode: a
broken branch breaks its own session's tools. Alternative: a user-scope
entry that binds every repository on the machine. Gerald chose the
committed wiring. Verdict: accepted with controls (the hooks exit silently
when the launcher or node is missing).

**Kept on the merits.** The claim-support check decides only by typed
calculation. The project-file format guard stops init from building on a
project it would misread. The Jira fixture reader is a documented offline
mode. `RESEARCH-DECISIONS.md` stays at the root, because STRATEGY and the
release manifests cite it by section.

## 9. The surface changes the audit deferred, each decided (2026-10-17)

Four changes reached every host, so each was decided on its own.

1. **One review workflow and one authoring workflow.** See decision 12.
2. **One claim authority per artifact.** See decision 13.
3. **Split the work service and the broker tools.** Accepted with controls:
   a mechanical split by lifecycle and by tool, landed only when no claimed
   work held those paths, proven by a byte-identical MCP `tools/list`
   before and after plus the full gate.
4. **The MCP tool surface.** The `owner` input that `submit_work` and
   `heartbeat` ignored is removed, and claim packets no longer return it,
   so hosts stop echoing it; a host that still sends it gets a typed input
   error. Tool descriptions say what each tool does and returns, and field
   rules live on their schema fields; the change was measured on the live
   intake record before and after.
5. **Typed host fields replace prose verdicts.** Checks that passed on a
   matching word now read fields the host fills: `setAside` names the
   settled statement an answer discusses, `superseded` takes
   `{ref, replacedBy}`, and a decision ask takes `decision: {ask, decider,
   by}`. Failure mode: a host model can fill a field falsely as easily as
   it writes a sentence. Control: a filled field must name a statement or
   reference that resolves, so a false entry is checkable where a false
   sentence was not. Alternative: drop the checks and leave the judgment to
   semantic review, which would also drop the only check that the cited
   item exists. Verdict: accepted with controls.

## 10. Evidence is identified by its bytes; the checkout is where they were read (2026-10-17)

**Question.** A managed step submitted from a linked git worktree could not
cite a file that existed only on that worktree's branch. A model cannot
manufacture a source, so one recorded identity may never stand for two
contents.

**Decision.**
1. A bare reference names a file in the checkout the session works in: its
   worktree when it runs in one, otherwise the main checkout.
2. The recorded identity of cited content is the reference plus the SHA-256
   of the bytes read. The receipt also names the checkout and its commit, as
   provenance, never as identity.
3. Every later comparison of a receipt (staleness, acceptance, the
   execution witness, delivery settlement, the frozen verifier contract,
   semantic review freshness) asks the resolver for the receipt's bytes. The
   resolver looks in its own checkout, then in the checkout the receipt
   names, and returns a file only when its digest matches. A receipt's
   checkout is honored only when it is one of the project's checkouts as
   read from the repository; nothing a model writes names one.
4. Submission, `construct run verify`, `construct run review`, delivery
   settlement, and the broker tools build their resolver through one
   function bound to the session's checkout.

**Challenge.** Strongest failure mode: two sessions citing the same path
from different checkouts ground their work in different bytes under the
same spelling. Controls: the receipt records digest, checkout, and commit,
and no receipt is satisfied by other bytes from any checkout. A worktree
removed before verification leaves its receipts stale, failing closed.
Best alternative: an explicit citation grammar with digests or branch
names. Rejected: a model would have to spell them, and the check
underneath would be the same digest comparison. Verdict: **accepted with
controls**.

## 11. A session's lane is where its host says it works, within the project's checkouts (2026-10-17)

**Question.** Claude's desktop app starts a session's MCP servers in the
main checkout even when the session runs in a linked worktree, so the
server's process directory named the wrong lane.

**What each host says (observed 2026-10-17).** Claude Code declares MCP
`roots` and answers with the session's directory. Codex CLI 0.163.0
declares no roots and starts the server in the session's directory. Cursor,
VS Code, OpenCode, and Bob were not observed and fall back to the process
directory.

**Decision.**
1. After the handshake, a server whose host declared `roots` asks for them
   once. The first tool call waits for the answer, at most five seconds.
2. A root counts only when it is a `file:` URI inside one of the project's
   checkouts as read from the repository. Anything else settles nothing.
3. A lane the host names replaces the one from the process directory before
   any tool runs.
4. The lane is settled once per connection; `roots/list_changed` is not
   followed.

**Challenge.** Strongest failure mode: a host that controls the roots puts
the session in another checkout and cites that checkout's bytes as its own.
Controls: roots come from the host's MCP client, not tool input; only the
project's own checkouts count; decision 10 pins the bytes. Best
alternative: read the session directory from hooks. Rejected: hooks are
Claude Code's alone and arrive after the server starts. Verdict:
**accepted with controls**.

## 12. Domain workflows share their graph and keep their contracts (2026-10-17)

Nine professional review workflows run as `review`, and PRD, proposal, RFC,
and research-brief authoring run as `authoring`, both keyed by `domain`.
The domain key is the bound skill id. Domain input schemas and step
overrides live in the merged workflow, and binding adds the skill's
required validators to the domain step. A per-domain diff taken before the
old manifests were deleted showed no validator or required input lost. The
unused `remember` workflow is gone; the remember tool records directly.

**Challenge.** Strongest failure mode: a generic graph erases a domain's
obligations. Best alternative: generate duplicate manifests from one
template, which keeps thirteen ids for the model to choose between.
Verdict: **accepted with controls**: explicit domain bindings, preservation
tests for every domain, and full lifecycle coverage. The former workflow
ids no longer resolve (decision 18).

## 13. A managed step's lease and its delivery reservation end together (2026-10-17)

A managed step holds a step lease, and `claim_work` also reserves the
requested artifact as a delivery item in the native work ledger. Two runs
cancelled on 2026-10-15 left their delivery items open.

**Decision.** A run that fails or is cancelled ends its reservation in the
same transition, whoever cancels it: the CLI, another session, or a trigger
replacing it. The reservation is cancelled, not released back to open.
`work ready` never lists a delivery item, and the generic `work` tool
refuses to claim, hand off, or settle one, naming `claim_work` instead.
`claim_work` is the gated workflow acquisition; `work` action claim is
ordinary ledger custody and never activates a workflow step.

**Challenge.** A design that collapsed both into one stored claim record
was proposed and rejected after an independent review against the code:
no host could hand off a delivery item, and custody between steps was
incidental to lease renewal. Strongest failure mode of the smaller fix:
execution and custody can still diverge through a path the fix did not
cover. Verdict: **accepted with controls**; the single-record design is
reopened only if divergence is observed.

## 14. Construct ships no plugin; skills reach hosts through init and ai-workflow-config (2026-10-17)

**Decision.** No plugin. `construct init` plants the operational skill in
the project skills directory each wired host reads. The method skills
reach a person's hosts through ai-workflow-config, which owns the personal
copies. Construct's own runs take a method's text from the registry, never
from a host's skills directory. `construct skill install` stays for an
explicit, by-name copy.

**Challenge.** Strongest failure mode: a person without
ai-workflow-config has no one-step way to put the method skills in their
host. They do not need them for Construct's work, since every managed step
receives its bound method in the claim packet. Best alternative: a
skills-only plugin package. Rejected for now as a third channel for the
same files, the kind of copy that drifted before. Verdict: **accepted**.
Reopen it when someone who does not use ai-workflow-config asks.

## 15. The native reviewer follows the Codex version the person runs (2026-10-17)

The held-text semantic reviewer is pinned to one exact Codex CLI version
(0.163.0, profile `codex-app-server-held-text-v2`). Every message
delivery, notification, and item type the profile does not know refuses
the review. `account/updated` passes only on subscription auth. The one
admitted warning is Codex's exact fail-closed code-mode sentence. Runs
frozen under an earlier profile stay unverified. No reviewer profile is
pinned to the gpt-6-astra model, which stays out of use; a reviewer on any
other model is requalified live before a release relies on it.

**Challenge.** Strongest failure mode: admitting a warning by its text lets
a later Codex send the same words for a different condition. Controls: the
match is anchored to the full sentence, and any version change refuses
until it is requalified. Best alternative: keep an older Codex installed
beside the one in use. Rejected: it qualifies a binary no one uses for real
work. Verdict: **accepted with controls**: the per-version pin plus a live
run of the three release controls before any release that changes it.

## 16. A release may ship without native semantic review, and says so (2026-10-17, revised 2026-10-19)

On 2026-10-17 Gerald took Codex and the gpt-6-astra model out of use, and
the only qualified reviewer ran on that model. On 2026-10-19 he allowed
Codex again on its default model (gpt-6.1-sol); gpt-6-astra stays out of
use.

**Decision.** An experimental alpha may ship without native semantic
review, but only in an explicit form: its manifest carries `nativeReview`
with status `unavailable`, a substantive reason, and the number of this
decision; it holds no review cases; and its host-support disclosure says
that semantic correctness of managed deliverables is unreviewed. `npm run
release:live -- --without-native-review` writes that form, and `npm run
release:check -- --tier=experimental-alpha` refuses a manifest that drops
the review cases without it. No reviewer and no eval cell is pinned to
gpt-6-astra. Codex stays a supported host.

**Challenge.** Strongest failure mode: a release that validates
deliverables with no independent semantic review reads as reviewed. The
manifest, the gate result, and the disclosure all say unreviewed, and the
gate refuses a silent omission. Best alternative: hold every release until
a qualified reviewer exists. Rejected by Gerald. Verdict: **accepted with
controls**.

## 17. Evals are maintainer-local and never enter git or a package (2026-10-19)

Gerald, 2026-10-19: "I want the evals removed; that is local only work."

**Decision.** The skill evals, the intake corpus and its live record, and
the eval-only harness and its tests live in an ignored `evals/` folder
with its own local history, and were removed from this repository's git
history. Skills do not ship or plant `evals/`, and a skill manifest has no
evals field. What tracked tooling shares with the harness (the surface
digest, the Cursor state snapshot, the host run limits) lives in
`scripts/host-surface.mjs` and `scripts/host-cli.mjs`. `release:check
--tier=qualified` loads the local harness and fails, saying why, when it is
absent; the experimental-alpha tier never uses it.

**Challenge.** Strongest failure mode: the qualified tier and the skill
eval runs are reproducible only on the maintainer's machine, and untracked
data has no remote backup. Best alternative: keep evals in git and exclude
them from the package. Rejected by Gerald. Verdict: **accepted with
controls**: `evals/` keeps its own git history, the qualified gate names
the missing harness, and the smoke run fails if a tarball or a planted
skill holds `evals/`.

## 18. Construct carries no compatibility code for earlier releases (2026-10-19)

Gerald, 2026-10-19: the project ends at a clean state with no legacy
patterns, references, or code.

**Decision.**
- State format is 6. A complete format 5 store is upgraded once, by
  `construct migrate`, after every session is stopped and a backup is
  taken. Any older, foreign, or incomplete store is refused unread, and the
  person runs `construct reset`.
- The upgrade drops the id map from the retired external tracker, so a
  lookup by one of its ids no longer resolves.
- The former review and authoring workflow ids no longer resolve; a host or
  script names `review` or `authoring` with a domain.
- Upgrading a planted skill no longer prunes files an earlier release
  planted, and no other shim for an earlier release remains.
- Git history was rewritten to drop the evals (decision 17).
- 3.0.0-alpha.32 is deprecated on npm.

**Challenge.** Strongest failure mode: installs and stores from earlier
alphas stop upgrading in place, and their owners must migrate from format
5, or re-init or reset from anything older. Best alternative: keep the
shims for one more release. Rejected: every release so far is an
experimental alpha with no stability promise, and a shim kept one release
is the pattern that kept the earlier ones. Verdict: **accepted** by
Gerald.


## 19. Deliver locally through two hosts with bounded assurance (2026-10-21)

Gerald approved the delivery plan after the adversarial audit: finish the existing
CLI/MCP application, stop further assessment campaigns, validate live only with
Claude Code and Codex, and simulate other hosts with explicit limits.

**Decision.** Ordinary questions stand down. Bounded reversible local tasks may
use direct-request admission in the existing ledger, with file claims and known
stakes. This records relayed purpose, never permission or acceptance. Substantial,
consequential, recurring or multi-agent outcomes retain managed workflows. Reuse
supplied plans without treating planning content as approval. Bound arithmetic
operands to held excerpts and keep structural, arithmetic, execution, semantic
and human-acceptance observations distinct. Keep sterile deterministic regressions
in normal tests; private/held-out data and generated traces stay local. Delivery
requires exact-package receipts for the two allowed hosts, with broadQualification
false. The qualified tier is retired rather than silently weakened or relabeled.
Public release still requires a separate direction.

**Challenge.** Strongest failure mode: a smaller delivery check could be mistaken
for demonstrated effectiveness or semantic correctness, while ordinary host work
would still be cheaper. Best simpler alternative: direct host execution. Adopt it
for bounded local work, retaining existing leases and sensitive-action controls.
The final gate requires both observed host walkthroughs and source/package hashes;
it checks records and bindings, not the truth of a maintainer's attestation.
Claude Code's resolved `claude-opus-5-5` challenged the plan; its arithmetic-binding,
routing-consistency and assurance objections are incorporated. Verdict: **accepted
with controls** under the approved local-delivery scope.

**History correction.** The wording in decisions 17/18 overstated eval removal.
Current main and package contents exclude the private corpus, but reachable
historical alpha tags retain earlier material. No complete history removal is
claimed, and no further history rewrite is directed.
