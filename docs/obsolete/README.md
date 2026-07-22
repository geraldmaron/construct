# Obsolete: historical-document policy

Only historical ADR, PRD, RFC, and research notes may remain in this directory,
plus `legacy-surface-register.md` as the explicit register of retired surfaces.
Every retained document must begin with an `Obsolete:` notice naming the
replacement or stating that no replacement exists.

Obsolete material is not included in the package, generated documentation,
runtime registries, host adapters, or active test fixtures.

New active documentation must use the current Construct vocabulary and roots:
`registry/`, `Workspace`, `Workspace Preset`, `Worker Profile`, `Procedure`,
`Assignment`, `Capability`, `Policy`, `Artifact`, `Evidence`, and `Projection`.
