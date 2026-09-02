# Security and privacy review: <target>

**Verdict:** <accepted | accepted with controls | needs validation | rejected>
Defensive review only: exposures, the paths that reach them, and the checks that would stop them.

## Threat model
| Component / flow | Trust boundary | Threat (STRIDE) | Control present? | Evidence |
|---|---|---|---|---|

## Access
<who can reach what, through which path; where authn and authz are checked>

## Secrets
<where they live, how they reach code, where they must never appear>

## Data
| Data | Classification | Retention | Flows across boundaries | Minimized? |
|---|---|---|---|---|

## Dependencies
| Dependency | Version | Advisory | Exposure |
|---|---|---|---|

## Detection
<what is logged; what misuse would be invisible>

## Findings
1. <finding> [fatal | serious | minor] — path: <how it is reached>; control: <present / absent>; evidence: <ref>; smallest fix: <sentence>

## Handed to governance-risk
<regulatory questions this raised>
