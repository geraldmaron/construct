---
name: docs-user-research-workflow
description: "Use when: cx-ux-researcher synthesizes user evidence — interviews, support tickets, session replay, surveys, or field notes."
inputs: [user-research, interview-data]
artifactType: evidence-brief
toneDefault: pedagogical
toneAllowed: [pedagogical, direct, friendly]
verificationBar: "Observed behavior weighted over self-report; sample size stated; no invented quotes."
---
# User Research Workflow

Use when: cx-ux-researcher gathers or synthesizes **user** evidence. Do not use for CVE lookups, API version facts, or repo structure — route those to cx-researcher or cx-explorer.

Follow [rules/common/research.md](../../rules/common/research.md) and call `get_skill("roles/researcher.ux")` before drafting.

## Steps

1. **Clarify the user question**: who specifically, what behavior or friction, falsifiable claim.
2. **Check internal user evidence**: `.cx/knowledge/external/`, customer profiles, evidence briefs, support exports, ingested transcripts.
3. **Choose source classes** (user-primary):

   | Source | Class | Notes |
   |---|---|---|
   | Interview transcript | primary | Direct quotes with participant id, not name |
   | Support ticket / chat | primary | Link ticket id; preserve ambiguity |
   | Session replay / analytics | primary | State segment and timeframe |
   | Survey (structured) | secondary | Note response rate and bias |
   | Sales / CS summary | secondary | Trace to underlying tickets when possible |

4. **Sampling**: state segment, N, recruitment method. Behavioral claims need ≥5 per segment unless exploratory (flag as low confidence).
5. **Validity**: name weakest validity threat (internal/external/construct/conclusion).
6. **Tone**: default `pedagogical`; override via `.cx/brand-voice.json` if present.
7. **Output**: `get_template("evidence-brief")` or `signal-brief` when threshold not met; store under `.cx/knowledge/internal/evidence-briefs/`.

## Verification bar

- No invented customer names, quotes, or ticket ids.
- Findings describe problems, not prescribed UI solutions.
- cx-ux-researcher must **not** cite blog posts for API version or security claims.
