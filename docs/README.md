# Documentation

The previous documentation system (96 ADRs, 5 RFCs, PRD trees, guides, ~387 files) was deleted on 2026-08-03 as part of the strategy rewrite. It encoded a superseded direction and had become a maintenance surface larger than its value.

## The new documentation contract

- **[STRATEGY.md](../STRATEGY.md)** (repo root) is the only standing strategy document: north star, end-state UX, architecture commitments, program shape, named risks.
- **Beads** is the only work record: the program graph, acceptance criteria, dependencies, and verification evidence live in the tracker, not in decision documents.
- **No ADRs, RFCs, or PRDs.** A decision is either an architecture commitment (goes in STRATEGY.md, replacing what it supersedes) or a work item (goes in beads). Documents that merely record that a decision happened are not written.
- **Docs regrow only when they earn their keep.** A new document is added here when a real reader (user or contributor) needs it repeatedly, not ahead of that need. Each addition names its audience and its maintenance owner in its header.
- **CHANGELOG.md** (repo root) remains the release record.

## What existed before

The deleted tree is recoverable from git history prior to 2026-08-03 if a specific document is ever needed for archaeology. Do not resurrect documents wholesale; extract the fact you need and cite the commit.
