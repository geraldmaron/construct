---
intake: none
---

Obsolete: retained as historical workspace-control-plane research; Construct 2.0 uses Worker Profiles, Workspace Presets, and `.construct/` — see docs/obsolete/legacy-surface-register.md.

<!--
  FIXTURE — not a real strategy document. Invented for construct-b0nny.5.4
  (Spike D). "Nimbus" is a fictional internal-tools product.
-->

# Nimbus — FY26 H2 Strategy (FIXTURE)

_Last reviewed: 2026-06-01 by fictional VP Product "Priya Nair"._

Nimbus competes for mid-market and early-enterprise teams evaluating
internal-tools platforms. Three pillars for H2:

## Pillar 1 — Time-to-first-value

Cut new-user time-to-first-value from ~35 minutes to under 10 minutes.
Onboarding friction is our #1 self-serve churn driver per the fictional Q2
churn survey.

## Pillar 2 — Enterprise footprint

Win the top 3 enterprise deals in the pipeline. All three require SSO; two
of the three explicitly require SCIM group provisioning in their security
questionnaires. Losing SSO/SCIM credibility blocks the enterprise motion for
the rest of the fiscal year.

## Pillar 3 — Reliability

Hold 99.9% monthly uptime [source: docs/notes/research/workspace-control-plane/spikes/d-daily-workplace-loop/fixture/README.md — this is a fictional fixture target, not a real SLA]. Reliability regressions are the fastest way to
lose the enterprise deals Pillar 2 depends on — an outage during a security
review resets vendor trust to zero.

## Explicit non-goals for H2

- Dark mode and other cosmetic settings are not a strategic priority this
  half; they may ship opportunistically but should never absorb roadmap
  capacity that Pillars 1–3 need.
- Feature requests that don't trace to one of the three pillars or an active
  enterprise deal should be deferred, not silently worked.
