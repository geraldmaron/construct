---
description: Canonical precedence order for resolving conflicting guidance.
enforced_by: lib/decisions/precedence.mjs
adr_reference: ADR-0015
---
# Rule precedence

When two rules give contradictory direction for the same situation, the conflict resolves by tier, not by recency or proximity in the prompt. The canonical order, highest priority first:

1. **safety** — preventing destructive or irreversible harm (data loss, secret exposure, production damage).
2. **security** — preventing unauthorized access, injection, or privilege escalation.
3. **correctness** — producing truthful, accurate, non-fabricated output that does what it claims.
4. **durability** — keeping decisions and state from silently drifting or being lost.
5. **performance** — speed, cost, and resource efficiency.
6. **style** — naming, formatting, comment convention, and other presentation choices.

A rule may declare its tier in frontmatter (`precedence_tier: <tier>`). A higher tier always governs: a style rule never overrides a correctness rule, and a performance optimization never overrides a safety constraint. The resolver lives in `lib/decisions/precedence.mjs`; `construct decisions check` fails if a rule declares a tier outside this list.

This sets the resolution order. It does not detect whether two rules contradict — that judgment stays with the author and reviewer.
