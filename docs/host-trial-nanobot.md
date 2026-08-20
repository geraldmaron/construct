# Host trial: the projection inside nanobot

Dated 2026-08-13. What happened when Construct's MCP projection was attached to
a host nobody designed it for, with a real project's outcomes as the subject.

## What was set up

- **Host:** nanobot v0.3.0 (HKUDS/nanobot, Python, MIT), installed with
  `uv tool install nanobot-ai`. This is the personal-assistant nanobot, not the
  Go MCP-host project of the same name published by obot-platform. The two are
  unrelated and the name alone does not identify either.
- **Instance:** its own config and workspace at `~/.nanobot-blackstory/`, so
  nothing touches a default instance. Attached over stdio through the
  documented key, `tools.mcpServers`:

  ```json
  { "tools": { "mcpServers": { "construct": { "command": "construct", "args": ["serve"] } } } }
  ```

- **Model:** a local model through Ollama, pinned in a preset rather than left
  to provider inference. The trial is about whether the surface survives a
  foreign host, so the run costs nothing and needs no key. `apiBase` must carry
  the `/v1` suffix; without it the provider answers `404 page not found` before
  any tool is reached, and the error names neither the provider nor the URL.
- **Subject:** BlackStory, a place-connected historical research platform, whose
  operator work is research triage and therefore the kind of decision the inbox
  exists for.

## What held

The projection loaded unmodified and the host model used it. It read the
catalog, then recorded three real outcomes with its own namings, each with a
stated reason, and every one of them passed the kernel's admission gate. The
runs are readable from the standalone CLI with the inference attributed to the
namer, which is the whole claim of the inversion working through a surface that
knew nothing about it:

```
343  implication-named  (inferred by: namer — a model read the outcome)
344  product-scoping    domain-implicated
```

Presence held its line as designed. Nothing dispatched, nothing advanced
completion, and no capability token was placed in the instance. That last one is
a standing condition of this trial, not an oversight: nanobot can enable chat
channels reachable from outside the machine, and a host holding a role's write
capability must never be one of them.

## What it exposed

**The host reaches whatever Construct is installed, not the repository.** The
machine's `construct` was 3.0.0-alpha.5 and answered with fifteen domains while
the working tree already carried seventeen. Nothing warned about the gap on
either side. A user who reads a catalog through a host is reading a released
catalog, and any claim about coverage made from inside a host is a claim about
the installed version.

**A missing concern is answered by the nearest available one.** Asked to record
"the atlas states its coverage by decade and region, so an empty area reads as a
known gap rather than as an absence of history," the model named `measurement`
and gave a reason that reads perfectly: declaring coverage makes what has been
recorded observable. It is the wrong concern. `measurement` asks whether a claim
about behavior can be observed; whether a collection's silence is a bias is a
different question, and the catalog now carries `coverage-gaps` for it. On the
installed version there was nothing else to name, and nothing in the record said
so — which is the behavior the unmet-concern record was built to end.

This is one run on one model and is written down as an observation, not a
measurement. It is worth stating only because it is the failure the catalog work
predicted, arriving unprompted from a model that had never read the argument.

## What is not settled

- Whether the inbox actually gets used more when it is reachable from a chat
  surface. Three recorded outcomes prove the path, not the habit.
- Whether nanobot is worth an execution adapter. That is a separate question
  from presence and turns on whether its OpenAI-compatible server reports usage;
  an adapter that cannot report cost cannot let the spend ceiling bind, and
  would record as unmeasured rather than free.
- Nothing here is a recommendation to relocate BlackStory's own scheduled
  discovery work, which stays where it is.

---

## Second pass, 2026-08-13: on a build that carries the work

The first pass ran against 3.0.0-alpha.5 and its first finding was that it had:
the machine's installed Construct answered with fifteen domains while the tree
carried seventeen, and nothing on either side said so. That is now closed in
both directions. The instance runs 3.0.0-alpha.10, and the catalog tool carries
the version answering it, so a claim about coverage made from inside a host
names the build it is a claim about. Asked which version had answered, the host
model read it straight off the catalog reply: `3.0.0-alpha.10`, seventeen
domains.

### What the surface now reaches

`records` and `record` are projected: a workspace's subjects, and one subject's
fields with the note citation that taught each value and every value it held
before. That is the read an operator triaging a research decision actually
needs, and before it they had to leave the surface — which is the complaint the
projection exists to answer.

`review`, `compose` and erasure are **not** projected, decided rather than
omitted. The first two are the CLI asking a host model several times and paying
for it, which is dispatch wearing the clothes of a read; the rule on this
surface has never been that reads are safe and writes are not, but that a host
model must not spend the user's money by being helpful. Erasure destroys a
subject and every value its fields ever held, irreversibly, because a person
asked to be forgotten — and this host can enable channels reachable from
outside the machine. The one operation with no way back stays in front of a
person at a terminal.

`drop_note` now says what it does. It said the context loop happened
"elsewhere", which a model relays as though the work were done somewhere the
user need not think about; it records the note and nothing else until someone
runs `construct notes --run`, and the tool description says to tell the user so.

### What held

A real BlackStory outcome recorded through the host produced briefs carrying the
gates that landed the same day — `ground-exhausted` on every role,
`rubric-security-Y2` on security, `rubric-system-design-D1` and
`strongest-objection` on system-design. The chain from a chat surface through
the projection to a brief that carries the reader's own acceptance lines works
through a host that knows nothing about any of it.

### What it exposed

**A privacy-defining field named in the project's own vocabulary reaches neither
router.** The outcome was whether the bulk canonical-edit path may change
`living_status` without a second approver. `living_status` is the field carrying
BlackStory's living-person privacy guarantee; the question is a privacy control
question. The host model named security, system-design, program-sequencing and
coverage-gaps — security is true and adjacent, "second approver" reads as
authorization — and did not name privacy. Run as a control on the same text, the
deterministic keyword map names *nothing at all*: privacy's keywords are generic
("personal data", "delete everything"), and the user wrote the question in their
own system's vocabulary. Neither path reaches the concern, for different
reasons, and the model's answer is strictly better than the fallback's silence.

One run, one local model, written down as an observation and not a measurement.
Tracked, with an explicit instruction not to close it by adding `living_status`
to a keyword list — that tunes the instrument to the one case anybody looked at.

---

## Repair note, 2026-08-20: the stale side of the handshake

The second pass closed half the version-skew finding: the catalog names the
build answering. The other half — the *older* build saying it is behind — could
not be closed by naming alone, because the installed Construct has no way to
see the tree. It now can, through the one place both builds visit: every CLI
open leaves the store a mark of the richest catalog it has been opened with
(advance-only, so the older build cannot erase the word the newer one left),
and a catalog read served by a build behind that mark carries a `stale` line
naming both versions and both domain counts. When nothing richer has touched
the store, the reply is byte-for-byte what it was.

Verified as a fixture equivalent of this trial's setup rather than a live
nanobot re-run: the projection test records a richer sighting on the store and
asserts the served catalog states the skew, and the sterile CLI test asserts an
ordinary command leaves the mark. A live re-trial on the next host pass will
read the line off a real skewed install.
