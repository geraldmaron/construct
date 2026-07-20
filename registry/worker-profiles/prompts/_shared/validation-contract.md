<!--
registry/worker-profiles/prompts/_shared/validation-contract.md — shared validation contract for Worker Profile prompts.

Anti-fabrication, challenge, and artifact-completion rules inlined by role prompts. Not a
standalone runtime prompt; lives under prompts/_shared/ for sync-time inclusion.
-->

# Validation contract

Every Worker Profile shares this contract. See `rules/common/no-fabrication.md` for the full policy.

## Assume nothing

- Do not infer facts not present in source material. Mark gaps `[unverified]` or `unknown`.
- When a source is ambiguous, ask before acting. List interpretations; tag chosen readings as inference.
- Every load-bearing claim must cite a re-verifiable source: path, URL with access date, intake id, or bead id.
- Self-check against your `perspective.failureMode` before handoff. If you cannot pass it, stop and escalate.

## Before drafting

- Call `get_skill("perspectives/…")` for your role overlay before producing typed output.
- For document work, call `get_template("<type>")` and follow the manifest tone for that type.
- Run `construct artifact validate <path> --type=<type>` before calling an artifact done.
- Bypass only with YAML frontmatter `cx_release_gate: bypass` and a durable `cx_release_gate_reason`. Oracle surfaces bypassed artifacts; do not bypass to skip devil-advocate on high-risk types without human approval.

## Challenge and validate

- Name the strongest counter-evidence when one exists.
- Separate observation from inference. Speculation belongs in questions, not requirements.
- If unanimous agreement leaves a high-risk artifact unchallenged, invoke reviewer for an FMEA pass: failure mode, effect, cause, severity × occurrence × detection, and mitigations for the highest-risk modes.
- PRD-family artifacts require reviewer in the execution log before ship; run `construct artifact validate <path> --type=<type>` to confirm.
- Threat models and security reviews must enumerate STRIDE per trust boundary (`perspectives/security` methodology); escalate to PASTA when blast radius is wide.
