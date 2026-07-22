---
description: deliverable artifacts are about the user's project, never about Construct or its internal machinery.
enforced_by: (Worker Profile prompt), lib/comment-lint.mjs
precedence_tier: correctness
---
# Tool Invisibility

Construct is scaffolding. The artifacts it helps produce — strategies, PRDs, ADRs, research briefs, memos, knowledge notes — belong to the user and their project. The user's document must carry no fingerprints of the tool that built it. A strategy authored through Construct should read exactly as if the user wrote it about their own product, with zero trace of the orchestration underneath.

This failed once, instructively: a strategy for a third-party project came back saying "Construct's bet is to own the layer…" and named `cx-product-manager` as a metric owner. The tooling had written itself into the user's deliverable. That is the failure this rule prevents.

## 1. The artifact is about its subject, not its author

A deliverable is about the project it concerns. Do not make Construct — or the act of using Construct — the subject of content it produces for another project. When the strategy is for *their* platform, the bets are *theirs*, not "Construct's."

## 2. Never name the tool or its internals in artifact content

In the body of any deliverable artifact, do not write:

- **`Construct`** as the product/company/subject (when the subject is not Construct).
- **Retired `cx-*` Worker Profile ids** (`cx-business-strategist`, `cx-product-manager`, `cx-researcher`, …). These are internal routing detail — the Construct front door already states that "internal routing and Worker Profile dispatch are implementation detail." A metric owner is a real role on the user's team (e.g. "Product", "Eng lead"), never a `cx-*` id.
- **Internal orchestration mechanics** — task-packets, `orchestration_run`, dispatch chains, handoff contracts — as if they were part of the user's product.

Provenance belongs in a comment or a separate handoff, not in the deliverable's prose.

## 3. The one exception: when the subject *is* Construct

When the project being worked on is Construct itself (this repo, package `@geraldmaron/construct`), naming Construct and its Worker Profiles is correct and required — the artifact is genuinely about them. The deterministic check below is disabled for the Construct repo for exactly this reason.

## Enforcement

- **Prevention (Worker Profile + shared guidance):** every Worker Profile and the Construct front door carry the invisibility directive, so the leak is avoided at generation time. This is the primary control; framing ("don't make the doc about Construct") is a judgment call the prompt owns.
- **Backstop (deterministic):** `lib/comment-lint.mjs` flags `cx-*` internal role-id tokens that appear in a *consuming project's* deliverable markdown — an unambiguous leak with near-zero false positives. The check is skipped when the working repo is Construct itself (package name `@geraldmaron/construct`). Severity follows `CONSTRUCT_ARTIFACT_LINT_MODE` (warn by default; block in the release gate).

## Bypass

There is no bypass. If the check fires on a legitimate use, the use is almost certainly a leak — rewrite the artifact to be about the user's project. If the subject genuinely is Construct, the self-repo skip already covers it.
