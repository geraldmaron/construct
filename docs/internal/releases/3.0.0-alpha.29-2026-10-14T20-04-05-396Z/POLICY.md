# Alpha.29 focused release-policy review

Verdict: accepted with controls for the experimental-alpha tier, 2026-10-14.
This is lead/shared-context policy review, not independent broad qualification.

The release retains the established tagged-main trusted-publishing workflow.
Strongest failure: a finite synthetic success could be presented as general
readiness or the prerelease could move `latest`. Controls: the manifest explicitly
sets broadQualification:false, retains failed fresh-user observations and substantive
limitations, and CI enforces the experimental gate before `npm publish --provenance
--tag alpha`. The tag must match the package version and be an ancestor of main.
Alternative: direct local publication. Rejected; it would bypass the established
checked-main/OIDC path. No workflow, authentication or security policy was changed.

Checks actually observed on the alpha.29 candidate:

- `npm run lint && npm run typecheck && npm test && npm run smoke`: exit 0;
  1,139 passed, zero failed, one skipped; packaged smoke passed.
- `npm run release:live`: exit 0; three distinct native Codex sessions completed
  using codex-cli 0.145.0 and requested gpt-6-astra with the version-pinned read-only
  held-text profile. Correct arithmetic succeeded. Wrong arithmetic and its
  injected-source variant were rejected with their exact drafts retained, held
  files unchanged and no observed tools or injected file.
- `npm run release:check -- --tier=experimental-alpha`: exit 0; exact version,
  current execution/model-facing digest, bundles, public transcript hashes,
  judgments, finite controls and disclosures accepted by the existing gate.
- `npm run lint`: exit 0 after final release-doc wording.

The candidate changes source permissions/provenance, state recovery, work restore,
CLI contracts and MCP binding as detailed in the committed remediation records.
Those code paths have regression and subagent review evidence. The historical
failed broad candidate judgment is preserved; it is not replaced by these synthetic
release controls. Canonical isolation, native fresh-user desktop readiness,
production adapter coverage, executor qualification, method effectiveness and the
setup/task facade remain open. These omissions rule out broader qualification.

Version 3.0.0-alpha.29 was absent from observed published versions before preparation.
Registry tags then read alpha=3.0.0-alpha.28 and latest=2.1.1. PR/main/release CI,
publication, downloaded-package smoke and final tag confirmation are still pending
at this record's commit; do not infer their success from this local policy review.
