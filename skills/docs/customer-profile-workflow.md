---
name: docs-customer-profile-workflow
description: "Use when: customer evidence should update durable product memory."
inputs: [signal, customer-profile]
artifactType: customer-profile
verificationBar: "Every load-bearing claim cites a verifiable source; label inference confidence; satisfy template structure requirements."
---
# Customer Profile Workflow

Use when: customer evidence should update durable product memory.

## Steps

1. Load the existing customer profile from `.cx/knowledge/internal/customer-profiles/` if present.
2. Read the new source evidence.
3. Add new facts, asks, pain points, contacts, product areas, and evidence links.
4. Preserve historical entries. Do not delete or rewrite prior history without explicit approval.
5. Save with `get_template("customer-profile")`.

## Rules

Profiles are product memory, not CRM records. Keep only information needed for product decisions. Mark uncertain facts as uncertain and cite the source.

## Retrieval

Customer profiles are indexed by hybrid retrieval. Future PRDs, PRFAQs, evidence briefs, and backlog proposals should search them before drafting.
