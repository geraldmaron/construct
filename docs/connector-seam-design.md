# The connector seam: where API-surface connectors live

Filed 2026-08-20 against epic construct-dr48, adversarially reviewed before
commit per house discipline (strongest failure mode, best alternative,
verdict). This is the design decision and the seam interfaces it licensed.
Jira and GitHub connectors have since been built at `src/connectors/jira/`
and `src/connectors/github/` against exactly this shape (construct-dr48.2,
.3); this page stays the record of why the shape is what it is, not a
description of what the connectors do. Any further vendor-specific adapter is
licensed the same way: gated by real need, built to this seam.

## What licenses this

STRATEGY.md commitment 1 and risk 4, amended 2026-08-16 (construct-1zx1),
recovered 2026-08-20 (construct-hmjn), in substance:

> Defined API connectors are licensed behind a hard use/build gate, as an
> amendment to this commitment's tool-broker reading: a connector may be
> built only where a real approved change must cross to ground the user's
> work already lives in and no host MCP surface can carry it; it stays
> adapter-tier and out of the kernel; and every run records which path read
> or wrote — host MCP first, connector fallback, honest refusal. A gated
> connector is an adapter, not a broker; the gate is the veto, and any
> connector proposal is challenged by name against it (risk 4 applied to
> integrations).

Everything below is that paragraph made structural.

## The recommended shape

Connectors live as adapter-tier modules under `src/connectors/<vendor>/`,
sibling to `src/hosts/`, never imported by the kernel. The seam is small
because the kernel already owns both shapes a connector must satisfy:

- **Reads** feed `SourceSurvey` (`src/kernel/run/sourcereads.ts`), which
  `readsFromSurvey` turns into `source_reads` rows carrying real coverage —
  listed, partial, or unreachable, never silent.
- **Writes** feed `ProposalApplier` (`src/kernel/run/apply.ts`), which
  `applyProposal` already gates on an approval row and records only what the
  host or connector reported succeeding.

A connector is, structurally, one more implementation of interfaces the
kernel already defines for hosts. It does not get its own kernel surface —
it gets a seam that produces the same evidence a host's MCP tools would.

## The adversarial pass

**Strongest failure mode against the recommended shape.** The licensed
ladder — host MCP first, connector fallback, honest refusal — puts an
*unverifiable* rung in front of a *verifiable* one and lets the first rung
close the transaction before the second is ever reached. Three facts already
in this repository make the risk concrete rather than hypothetical:

1. The pinned OpenCode expectation records that `OPENCODE_CONFIG` *merges*
   with the operator's own config rather than replacing it — Construct
   cannot know whether a Jira tool is actually present in a given host
   session before paying to find out (`src/hosts/opencode/pin.ts`).
2. `createHostApplier`-style code returns whatever boolean the model
   emitted for `applied`. A model that claims success without doing
   anything closes the proposal, and the connector fallback never runs —
   the ladder's second rung is dead code the moment the first rung lies.
3. The two rungs do not even produce the same *kind* of artifact. A host
   read is testimony — a model's report about what it did — while a
   connector read is a survey with real, structural coverage. Treating them
   as interchangeable evidence would blur exactly the distinction
   `readsFromSurvey`'s own comments insist on.

**Best alternative considered.** Ship each connector as a standalone MCP
server registered into the host's own config, rather than as adapter-tier
code Construct calls directly. This collapses the ladder to one rung (there
is no "connector fallback," only "is the MCP server there or not") and
trades a regex-shaped gate for process isolation.

**It loses.** It reopens exactly the defect the 2026-08-03 adversarial
review closed — an ungated write surface a role can drive on its own — now
against a vendor's live system instead of Construct's own store. It cannot
produce `SourceSurvey`-shaped coverage provenance, because the kernel never
sees the read at all; it only sees whatever the model chose to report. And
on OpenCode, whose pin is what records this exact behavior, it does not even
buy the isolation it promises: `OPENCODE_CONFIG`'s merge behavior means a
"standalone" server is exactly as exposed to the host's other tools as an
adapter-tier call would be.

**Verdict: the recommended shape is accepted, with a control.** The ladder
is ordered by *authority* — who is licensed to act — not by *fidelity* —
whose account of what happened can be trusted at face value. Those are
different axes, and collapsing them is the failure mode above. The control:
every recorded read or write carries an evidence class alongside its
coverage —

- `witnessed` — the kernel constructed the record itself from something it
  can inspect (a `SourceSurvey`, an `ApplyReport` the connector's own return
  value backs with a fetchable receipt).
- `reported` — the kernel is relaying a host's or model's claim about what
  happened, unverified beyond the claim itself.

A host-MCP read or write is `reported` by default (it is testimony) unless
the host adapter can show its own receipt; a connector read or write is
`witnessed` by construction (the connector's own code produced the survey
or the apply result). This does not change the ladder's *order* — host MCP
still goes first, because presence beats absence, and a workspace with a
real host tool should not pay a connector's build cost to duplicate it. It
changes what a reader is told about what they are holding, which is the
actual promise commitment 15 makes.

## The forbidden-import rule

Named as an allow-list, so it also blocks a future connector from quietly
becoming a dependency:

- `src/kernel/**` may not import `src/connectors/**`.
- `src/connectors/**` may import only `src/kernel/**`, its own connector's
  own modules, and Node builtins — never a host adapter, never another
  connector. The own-modules clause is what "another connector" always
  meant, made explicit when the first connector was built: a vendor's pin,
  its wire, and the module that reads them are one connector, and a rule
  forbidding them each other would force every connector into a single file
  while the adapter tier beside it stays multi-file. A sibling vendor
  directory is still another connector and still forbidden.
- `src/hosts/**` may not import `src/connectors/**` — a host and a
  connector are separate answers to "how does work reach the outside
  world," and a host reaching for a connector would be the tool-broker
  Construct has refused twice now (commitment 1's original text, and this
  amendment) reappearing sideways.
- `scripts/**` and `bin/**` may not import `src/connectors/**` — the
  package's own build and CLI entry points stay connector-free.

`src/cli/**` is deliberately *not* forbidden. The gate is on what
Construct's kernel and build depend on, not on what its surface can offer a
user who has explicitly opted into a connector — commitment 1's line "why
Construct's own build never uses product connectors" is a claim about the
build, not about every command the CLI could ever expose.

The lint enforcing this rule is `scripts/lint-connector-gate.mjs`
(`construct-dr48.5`), landed ahead of the first connector as designed. The
Jira and GitHub connectors themselves (`construct-dr48.2`, `.3`) are built on
this seam, each gated on real need per the use/build gate above. The GitHub
connector's pin has since been traced against a real, disposable scratch
repository, with one expectation still unprobed (`repo-lookup-404s-honestly`,
named in `src/connectors/github/connector.ts`); the Jira connector is built
and pinned but has not yet made a live call against a real or scratch Jira
project. Any further vendor adapter waits on the same gate, not on this
document alone.
