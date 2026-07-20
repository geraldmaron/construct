---
title: Q1 2026 agent failure modes — synthesis from production fleet
status: synthesis
owner: cx-researcher
period: 2026-01-01 to 2026-03-31
sources_n: 4
intake_id: null
intake: none
intake_rationale: Authored before intake provenance was introduced
---

# Q1 2026 agent failure modes

Synthesis of 4 evidence sources: production trace store (`traces.agent_runs` table, n=2,341,807 runs), customer-reported tickets tagged `agent-behavior` (n=89), the failure-mode survey of 22 enterprise customers (March 2026), and the internal eval suite `q1-2026-baseline` (n=247 questions across 8 categories).

Verbatim quotes are anonymized to tenant id and dated. Anything inferred without a source carries `[unverified]`.

## Top failure modes (by occurrence)

### 1. Context overflow during long tool sequences (38% of failed runs)

Definition: agent's context grew past 80% of the model's window before reaching a final answer. Truncation drops the original task; agent forgets goal.

Evidence: 891,008 runs (out of 2.3M) terminated with a final answer that didn't address the original prompt. Sample of 50 such runs: 47 showed context truncation before failure. The other 3 had different causes (one tool error, two model refusals).

Tenant `t_8f12` (March 4): "The agent answered a totally different question. I asked about Q1 revenue and it gave me a weather report."

Drives: [PRD-0001](../prd/0001-tool-calling-scratchpad.md).

### 2. Repeated identical tool calls (22% of failed runs)

Definition: same tool, same arguments, called 3+ times in one run. Often indicates the agent isn't reading its own prior output.

Evidence: deduped tool-call hashes show 510,237 runs with repeated calls. p95 repeat count: 4. Top repeated tool: `web_search` (38% of repetitions), then `file_read` (29%), then `code_exec` (12%).

### 3. Tool output not sanitized before re-prompting (8% of failed runs)

Definition: tool returns content that includes an instruction-shaped string, agent treats it as a new task.

Evidence: 187,232 runs flagged by the prompt-injection detector. Sample 30: 28 confirmed prompt injection (a web search returning a page that says "ignore previous instructions"). 2 false positives.

**Security implication. Separate finding tracked in `.construct/inbox/security-scan-finding-2026-05-15.json`.**

### 4. Cross-tenant memory recall (rare but high-severity, 0.05% of runs but flagged 12 tenant complaints)

Definition: memory-recall tool returns observations from a different tenant.

Evidence: only 1,170 runs out of 2.3M. But 12 customer tickets in Q1 (vs ~25 total tickets in the period). High severity: customer complaints reach exec inbox.

Drives: [PRD-0002](../prd/0002-memory-isolation.md).

### 5. Hallucinated tool output (2% of failed runs)

Definition: agent claims a tool was called and returned X, but the trace shows no such call.

Evidence: 46,836 runs. Common pattern: agent says "I searched and found..." with no web_search trace entry. Almost always happens after the agent ran out of tool budget and the harness blocked further calls; the agent confabulates rather than admit it couldn't search.

## What we observed but cannot yet quantify

- **Cold-start latency on memory-heavy agents.** Sample of 12 customer reports. Need eval `q2-cold-start-bench` (not yet built) to quantify.
- **Confidence calibration.** Agents claim high confidence on demonstrably wrong answers. `[unverified]` rate; needs an eval that scores confidence + correctness jointly.

## Methodology notes

- Trace store snapshot taken 2026-04-02. Tenant filtering: excluded `dev-*` test tenants (~14% of total volume).
- Eval suite `q1-2026-baseline` defined March 2026; questions are stable but the grading rubric was tightened mid-quarter, so within-period comparison is OK but trend lines to Q4-2025 are not reliable.
- Customer survey response rate: 22 of 41 invited (54%). Self-selection bias toward heavy-usage customers acknowledged.

## Sources

- `traces.agent_runs` table snapshot 2026-04-02 (query saved at `.construct/knowledge/internal/q1-trace-query.sql`)
- Customer ticket export Q1 2026 (zendesk-style format, `[unverified]` — not preserved in repo)
- Enterprise customer survey March 2026 (n=22 responses)
- Eval bench `q1-2026-baseline` (run id `eval-2026-03-31-baseline`)
