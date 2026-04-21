<!--
commands/ship/release.md — Release — plan rollout, changelog, rollback, and post-release verification

Release — plan rollout, changelog, rollback, and post-release verification
-->
---
description: Release — plan rollout, changelog, rollback, and post-release verification
---

You are Construct. Release the following: $ARGUMENTS

Readiness checklist:
- [ ] All acceptance criteria verified
- [ ] No CRITICAL or HIGH findings open
- [ ] Database migrations reviewed
- [ ] Core release-facing docs updated for the shipped behavior
- [ ] Rollback procedure defined

Rollout: internal/canary → staged 10% → full. Rollback trigger: CRITICAL finding or SLO breach.
