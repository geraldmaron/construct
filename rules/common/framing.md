<!--
rules/common/framing.md — how to frame a problem before acting on it.

Establishes the hard separation between execution artifacts (tickets, chat
transcripts, existing docs) and sources of truth (the underlying problem).
Applies to every specialist working on architecture, documentation, research,
product, or strategy work. Read before scaffolding anything.
-->
# Framing Policy

Most agent failures on ambiguous work trace to a single mistake: anchoring on the most concrete input available (usually a ticket or a prior doc) and building the output around its structure instead of around the actual problem.

Construct's default behavior must be the opposite.

## 1. Execution artifacts are not sources of truth

The following are **execution signals**, not the problem itself:

- Jira tickets, Linear issues, GitHub issues
- Chat transcripts, Slack threads, email threads
- Existing PRDs, RFCs, design docs
- User-provided summaries of "what we want"
- Prior conversation history with the user

They describe **how the problem was reported**, **what has been tried**, or **what someone thinks the solution is**. They do not define what the problem is.

Treating them as source of truth produces output that reflects the reporting structure, not the underlying need. That is the failure mode this rule exists to prevent.

## 2. Required framing step before scaffolding

Before scaffolding any architecture, documentation set, research brief, PRD, ADR, RFC, or roadmap, **state the underlying problem in your own words, independent of how it was reported**.

A valid problem statement:

- Describes an outcome someone needs, not a ticket title
- Does not reference ticket IDs, PRD filenames, or chat excerpts
- Would be legible to a reader who has never seen the inputs
- Names the constraint that makes the problem non-trivial

If you cannot produce this statement without referencing the inputs, you have not framed the problem. You are paraphrasing the inputs.

## 3. ADR / PRD / RFC content rules

- **ADR "Problem" section** must describe a decision-forcing tension in the domain. It must not describe the documents, tickets, or process that surfaced it.
- **PRD "Problem" section** must describe a user or business outcome that is currently blocked. It must not describe the roadmap item or ticket that initiated the work.
- **RFC "Motivation" section** must describe the technical or product pressure that makes the change worth its cost. It must not describe the meeting or request that triggered the RFC.

If a reader needs the ticket to understand the doc, the doc is failing its job.

## 4. When the inputs disagree with the inferred problem

If tickets, transcripts, or prior docs point at a different problem than the one you infer:

- Surface the mismatch explicitly
- Propose the reframed problem statement
- Ask the user once, then proceed with the reframed version if no answer

Do not silently adopt the input framing because it is easier.

## 5. Anti-patterns

Do not:

- Title documents after tickets or PRD filenames
- Structure information architecture around the artifacts that described the problem
- Write an ADR whose "Decision" is "we will have these documents" or "we will use this ticket structure"
- Produce a research brief whose sources are all internal tickets and transcripts
- Frame the "Rejected alternatives" section as "we considered not doing this ticket"

## 6. The one-sentence test

Before any artifact is considered framed, it must pass:

*"A principal engineer reading only this document, with no access to any tickets or prior context, would understand what problem is being solved and why it matters."*

If the document fails that test, it is not framed. It is a changelog entry wearing a different costume.
