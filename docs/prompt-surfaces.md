# Prompt Surface Architecture

Construct has one public prompt surface and several internal prompt-adjacent layers.

This document is the canonical reference for that split.

## Public vs internal

Public prompt surface:

- `personas/construct.md` is the sole public persona and the only user-facing entry surface.

Internal execution surfaces:

- `agents/prompts/cx-*.md` are internal specialist prompts used only through Construct's routing.
- `skills/roles/*.md` are internal role overlays that encode anti-patterns, counter-moves, and self-checks.
- `commands/**/*.md` are command prompt assets that support specific workflows but do not replace the public persona.

offline-only regression surfaces:

- `examples/**` contains shipped example fixtures for regression, evaluation, and future harnesses.

## Runtime contract

At runtime:

- the user talks to Construct
- Construct classifies the request and routes work internally when needed
- specialists and role overlays are implementation detail, not peer user-facing personas

The routing contract lives in code and prompt policy, not in the examples corpus.

## File responsibilities

- `personas/construct.md`
  - public behavior contract
  - approval boundaries
  - routing discipline
  - quality gates

- `agents/prompts/cx-*.md`
  - internal specialist voice and task posture
  - local constraints for that specialist
  - references to the relevant role overlay and domain skills

- `skills/roles/*.md`
  - reusable role anti-patterns and self-checks
  - shared behavioral guardrails reused across multiple specialists

- `examples/personas/construct/**`
  - public persona fixtures for Construct behavior

- `examples/internal/roles/**`
  - internal role fixtures for high-leverage routed behavior

## Visual deliverables

Construct should treat visual artifacts as real deliverables, not as prose-only placeholders.

Primary owners and outputs:

- `construct` routes the request and keeps the user-facing contract coherent
- `cx-designer` owns wireframes, low-fi layouts, product-facing diagrams, slide decks, and presentation-grade visual packaging
- `cx-architect` joins when a diagram expresses system boundaries, contracts, sequencing, or dependency structure
- `cx-product-manager` or `cx-docs-keeper` may own the underlying written content, but a visual deck remains a visual deliverable when the user explicitly asks for one

Tools and skills to prefer when available:

- `construct wireframe` for low-fi Mermaid and HTML wireframes
- host visual skills for presentation and polished design work
- Playwright/browser tooling for demo capture and walkthrough recording
- document ingest before deck generation when the source material arrives as `.pptx`, PDF, spreadsheet, or export

Preferred artifact forms:

- Mermaid for flow, sequence, state, ER, and journey diagrams
- low-fi HTML for layout wireframes
- viewport-safe HTML presentations for decks and slide work
- recorded browser demos for walkthrough requests

## Why this split exists

The split is intentional:

- prompts stay lean enough to preserve token budget and avoid drift
- role overlays hold reusable failure-mode guidance instead of duplicating it in many prompt files
- examples stay outside runtime prompts so regression assets can grow without bloating execution context

## Terminology

Use these terms consistently:

- `persona`: public prompt surface
- `specialist prompt`: internal `agents/prompts/cx-*.md` surface
- `role overlay`: internal `skills/roles/*.md` guidance layer
- `example fixture`: offline regression/eval case under `examples/**`

Avoid calling internal specialist prompts and role overlays "core public surfaces".

## Coverage policy

Required public fixture coverage:

- `construct` must have at least one `golden`, one `bad`, one `boundary`, and one `adversarial` fixture

Required internal fixture coverage:

- high-leverage internal role layers must have at least one `golden` and one `bad` fixture
- current required internal roles: `architect`, `engineer`, `reviewer`, `qa`, `orchestrator`

Optional internal fixture coverage:

- narrower or specialized internal roles may add fixtures as they become behaviorally important or historically failure-prone

## Authoring guidance

- Put policy in prompts and overlays.
- Put examples in fixtures.
- Put failure explanations on bad fixtures.
- Add in-prompt examples only when a behavior is hard to specify precisely with rules alone.
