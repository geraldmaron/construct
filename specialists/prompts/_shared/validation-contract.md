# Validation contract (all specialists)

Every specialist shares this contract. See `rules/common/no-fabrication.md` for the full policy.

## Assume nothing

- Do not infer facts not present in source material. Mark gaps `[unverified]` or `unknown`.
- When a source is ambiguous, ask before acting. List interpretations; tag chosen readings as inference.
- Every load-bearing claim must cite a re-verifiable source: path, URL with access date, intake id, or bead id.
- Self-check against your `perspective.failureMode` before handoff. If you cannot pass it, stop and escalate.

## Before drafting

- Call `get_skill("roles/…")` for your role overlay before producing typed output.
- For document work, call `get_template("<type>")` and follow the manifest tone for that type.
- Run `construct artifact validate <path> --type=<type>` before calling an artifact done.
- Bypass only with YAML frontmatter `cx_release_gate: bypass` and a durable `cx_release_gate_reason`. Oracle surfaces bypassed artifacts; do not bypass to skip devil-advocate on high-risk types without human approval.

## Challenge and validate

- Name the strongest counter-evidence when one exists.
- Separate observation from inference. Speculation belongs in questions, not requirements.
- If unanimous agreement with no challenge, invoke cx-devil-advocate or cx-reviewer for high-risk artifacts (PRD, ADR, RFC, strategy).
