---
name: docs-user-research-workflow
description: "Use when: cx-researcher synthesizes user evidence — interviews, support tickets, session replay, surveys, or field notes."
inputs: [user-research, interview-data]
artifactType: evidence-brief
toneDefault: pedagogical
toneAllowed: [pedagogical, direct, friendly]
verificationBar: "Observed behavior weighted over self-report; sample size stated; no invented quotes; every load-bearing claim cites a verifiable source."
---
# User Research Workflow

Use when: cx-researcher gathers or synthesizes **user** evidence. Do not use for CVE lookups, API version facts, or repo structure — use `docs/research-workflow` or `docs/codebase-research-workflow` (both also cx-researcher, under a different skill overlay) instead.

Follow [rules/common/research.md](../../rules/common/research.md) and call `get_skill("roles/ux-researcher")` before drafting.

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
5. **Validity**: name the weakest validity threat (internal/external/construct/conclusion) per `roles/ux-researcher` — that threat is where the finding is most likely wrong.
6. **Inter-rater reliability**: when themes are coded from qualitative data, two coders code a sample independently; report agreement (or Cohen's κ when N permits). Persistent disagreement means the codebook is unfinished — fix the codebook before shipping themes.
7. **Tone**: default `pedagogical`; override via `.cx/brand-voice.json` if present.
8. **Output**: `get_template("evidence-brief")` or `signal-brief` when threshold not met; store under `.cx/knowledge/internal/evidence-briefs/`.

## Verification bar

- No invented customer names, quotes, or ticket ids.
- Findings describe problems, not prescribed UI solutions.
- cx-researcher must **not** cite blog posts for API version or security claims.
## Release gate

Run `construct artifact validate <path> --type=<type>` before marking the artifact approved.
