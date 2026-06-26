---
description: every human-facing Construct output is formatted for neurodivergent readers — without reshaping machine-readable output.
enforced_by: (persona prompt), tests/term-format.test.mjs
precedence_tier: style
---
# Neurodivergent-Friendly Output

Construct's output is read under load — in a terminal, mid-task, often by people who process text differently. Dense walls of prose, buried conclusions, inconsistent structure, and meaning carried only by color cost every reader attention, and cost neurodivergent readers more. This rule applies to **every human-facing output** Construct produces: terminal output, agent prose to the user, reports, and error messages.

It is a `style` rule by design. The precedence resolver (`rules/common/precedence.md`) guarantees a style rule never overrides a higher tier — so when accessible formatting would conflict with correct machine output, correctness wins automatically. Section 0 states that boundary explicitly.

## 0. The human/machine boundary (read this first)

Two layers, treated differently:

- **Presentation layer (human-facing)** — section titles, prose, help text, report narratives, guidance notes, error wording. This is what the rest of this rule shapes.
- **Data layer (machine-readable)** — never reshape it for readability. Off-limits: any `--json` / `--plain` output; `specialists/org`, `contracts.json`, `role-manifests.json`; the parsed tokens hooks emit (for example the session-start `## Working branch: **<name>**` line, the efficiency status enum `degraded` / `configured` / `healthy`, commit hashes, counts); auxiliary state JSON; any text one component parses out of another.

When a format choice would change a value, key, ordering, or token that something downstream parses, do not make it. Accessibility is presentation; it never edits the contract.

## 1. Lead with the answer

State the conclusion first, then the support. The reader should get the outcome — what happened, what is needed, what changed — in the first line, before any reasoning. Put deliberation after the answer, or leave it out.

## 2. One clear hierarchy

Use headings in order (H2, then H3) and do not skip or nest deeper. One `h1`-equivalent per surface. A reader should be able to scan headings alone and know the shape of the output.

## 3. Scannable chunks

Short paragraphs with white space between sections; prefer three short lines over one dense one. Use a bulleted or numbered list for genuinely parallel items — a set of options, steps, or independent facts — where scanning is the point. Keep reasoning, cause-and-effect, and narrative in prose: a wall of bullets fragments the logic that connects the points and is harder to follow, not easier. Bullets for what scans, sentences for what reasons.

## 4. Plain, literal language

Say the thing directly. Avoid idioms, sarcasm, irony, and figurative phrasing that require inference to decode. Define a term on first use or link to where it is defined. One name for one concept — do not alternate synonyms for the same thing.

## 5. Consistent structure and terminology

The same kind of output keeps the same shape every time. Status reports, error messages, and command help follow a predictable order so the reader learns the pattern once. Predictability lowers cognitive load more than cleverness raises it.

## 6. Explicit state and next step

End human-facing output with the current state and the next action in plain words — what is done, what is blocked, what the reader does next. Never bury the ask. Never imply a next step through tone.

## 7. Never let color, emoji, or motion be the only signal

- Meaning carried by color must also be carried by text, shape, or label. A red number is also labelled `error`; a green check is also the word `passed`.
- Honor `NO_COLOR`, non-TTY, and `TERM=dumb`: degrade to plain text, never to nothing.
- Respect terminal width — wrap rather than overflow.

## Applies to

- **Terminal / CLI** — help text, status, reports, hook display. Routed through the shared formatter (`lib/term-format.mjs`); color and width handled there, never per-call.
- **Agent prose** — every response Construct and its specialists return to the user.

## Enforcement

- Persona prompt: `personas/construct.md` carries the output-style directive; specialists inherit the standard through the front-door agent.
- `tests/term-format.test.mjs` asserts the terminal formatter honors `NO_COLOR` / non-TTY and that machine-readable `--json` output is unchanged by presentation changes.

## Bypass

There is no bypass. If a format choice and a machine contract conflict, the contract wins (Section 0) — change the presentation, never the data. If this rule is wrong-shaped, fix the rule, not the output.
