---
title: Decisions
description: Architectural memory — ADRs, RFCs, PRDs.
---

Construct keeps three kinds of durable decision artifact, each with a numbered, append-only history.

## ADRs (Architecture Decision Records)

Short records of an architecturally significant decision that's already been made. Captures the choice, the alternatives considered, and the consequences.

Browse the [`docs/decisions/adr/`](https://github.com/geraldmaron/construct/tree/main/docs/decisions/adr) directory on GitHub.

Latest: [ADR-0044 — Tool-repo root layout hygiene](./adr/0044-tool-repo-root-layout.md). See also [ADR-0041 — Terminal chat owned loop](./adr/0041-terminal-chat-owned-loop.md) and [ADR-0043 — Oracle meta-controller](./adr/0043-oracle-meta-controller.md).

## RFCs (Request for Comments)

Proposals for significant changes that need feedback before commitment. Each RFC names a problem, surveys options, proposes a direction, and lays out a migration plan.

Browse the [`docs/decisions/rfc/`](https://github.com/geraldmaron/construct/tree/main/docs/decisions/rfc) directory on GitHub.

## PRDs (Product Requirements Documents)

Specifications for a feature or product — problem, audience, requirements, success criteria.

Browse the [`docs/specs/prd/`](https://github.com/geraldmaron/construct/tree/main/docs/specs/prd) directory on GitHub.

## How the lanes work

The plural directories (`templates/docs/prds/`, `templates/docs/rfcs/`, etc.) are init lane templates — `construct init` clones them into downstream projects. The singular directories (`docs/specs/prd/`, `docs/decisions/rfc/`, `docs/decisions/adr/`) hold *this* repo's numbered artifacts.
