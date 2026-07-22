---
title: Intake loop
description: The eight-step pipeline that turns inbox signals into routed work, evidence, and durable learning.
---

# Intake loop

Construct's governed loop runs the same eight-step pipeline regardless of workspace type. The active Workspace Preset (`rnd`, `operations`, `creative`, `research`, or a custom one) determines the taxonomy at the classification step; everything else is preset-agnostic.

For the operator's view of how to interact with this pipeline, see [Intake and triage](/guides/concepts/intake-and-triage). This page is the implementation deep dive.

## Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         INTAKE LOOP                                         │
│                                                                             │
│   Signal → Classify → Retrieve → Dispatch → Execute → Evidence → Learn      │
│                                                                             │
│   The classify and dispatch steps consult the active profile.               │
│   The other six steps are identical across profiles.                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Step-by-Step Flow

### 1. Signal Ingestion

**Input:** Files dropped into `inbox/`

```
inbox/
├── login-feedback-20260518.md      ← User signal (support ticket)
├── session-timeout-bug-20260517.md ← Bug report
├── feature-request-sso.md          ← Feature request
└── incident-20260519.md            ← Incident report
```

**What happens:**
- `InboxWatcher.poll()` detects new files
- Content extracted (text, markdown, PDF, etc.)
- File passed to `prepareIntakeForIngestedFile()`

### 2. Deterministic Classification

**Module:** `lib/intake/classify.mjs`

```javascript
const triage = classifyRdIntake({
  sourcePath: 'login-feedback-20260518.md',
  extractedText: '...',
  related: [],
});

// Output:
{
  intakeType: 'user-signal',      // What kind of work
  rdStage: 'signal',              // Where in the active profile's loop
  primaryOwner: 'product-manager', // Who owns it
  recommendedChain: ['product-manager', 'ux-researcher', 'researcher'],
  recommendedAction: 'clarify',   // What to do
  risk: 'low',                    // Risk level
  requiresApproval: false,        // Gate requirement
  confidence: 1.0,                // Classification confidence
  rationale: 'Matched keywords: customer, feedback, support ticket'
}
```

**Classification Table (12 types):**

| Intake Type | Keywords | Owner | Action |
|-------------|----------|-------|--------|
| `security` | secret, cve, vulnerability, exploit | security | diagnose |
| `incident` | outage, slo breach, down, p0 | sre | create-runbook |
| `bug` | bug, error, regression, crash | debugger | diagnose |
| `user-signal` | customer, feedback, pain point | product-manager | clarify |
| `requirement` | acceptance criteria, must have | product-manager | draft-prd |
| `architecture` | adr, rfc, interface, tradeoff | architect | draft-rfc |
| `research` | competitor, market, benchmark | business-strategist | research |
| `experiment` | hypothesis, a/b test, spike | rd-lead | create-experiment |
| `eval-finding` | eval, hallucination, recall | evaluator | evaluate |
| `launch-asset` | release, changelog, ship | release-manager | release-review |
| `ops` | runbook, cron, backup | operations | create-runbook |
| `legal-compliance` | gdpr, ccpa, soc2 | legal-compliance | clarify |

**Key design:** NO LLM CALL. Keyword-based, deterministic, cheap.

### 3. Knowledge Retrieval

**Module:** `lib/storage/hybrid-query.mjs`

```
Query: "session timeout login authentication user friction"

Retrieved Documents:
┌────────────────────────────────────────────────────────────────┐
│ Document                              │ Score │ Relevance      │
├────────────────────────────────────────────────────────────────┤
│ adr-session-management.md             │ 89%   │ Direct match   │
│ prd-authentication-improvements.md    │ 72%   │ Related req    │
│ obs-pattern-login-friction.json       │ 65%   │ Historical     │
└────────────────────────────────────────────────────────────────┘
```

**Hybrid Search:**
1. **BM25**. Keyword matching (fast, exact)
2. **Vector**. Semantic similarity (ONNX embeddings, 384-dim)
3. **Reciprocal Rank Fusion**. Combines both rankings

**Fallback:** If Postgres unavailable → local JSON index

### 4. Worker Profile Dispatch

**Module:** `lib/orchestration-policy.mjs`

```javascript
// For bug intake:
Dispatch Chain:
  1. debugger         (primary. root cause analysis)
  2. engineer         (implementation)
  3. qa               (verification)
  4. reviewer         (parallel. code review)
  
// For user-signal intake:
Dispatch Chain:
  1. product-manager  (primary. clarify requirements)
  2. researcher       (user research + competitive analysis)
```

**Parallel Checks** (new in 2026 enhancements):

```javascript
identifyParallelChecks({ request, riskFlags })
// Returns: ['security', 'designer']

// These run concurrently with implementation for faster feedback
```

### 5. Execution (Worker Plane)

**Module:** `lib/worker/run.mjs`

```
┌─────────────────────────────────────────────────────────┐
│  Worker Execution                                       │
├─────────────────────────────────────────────────────────┤
│  • Bounded timeout (default: 300s)                     │
│  • Path policy (can't escape project)                  │
│  • Restricted env (only PATH, HOME, etc.)              │
│  • Evidence capture (stdout, stderr, files)            │
└─────────────────────────────────────────────────────────┘
```

**Evidence Record:**

```json
{
  "nodeId": "node-engineer-1",
  "evidenceType": "implementation-result",
  "filesChanged": ["lib/auth/session.mjs"],
  "testsRun": 15,
  "testsPassed": 15,
  "summary": "Implemented sliding session with 5-min warning"
}
```

### 6. Knowledge Storage

**Module:** `lib/observation-store.mjs`

```javascript
// After work completes:
addObservation(rootDir, {
  role: 'engineer',
  category: 'decision',
  summary: 'Implement sliding session with 5-min warning + auto-save hook',
  content: 'Full context of the decision...',
  tags: ['session', 'implementation', 'user-experience'],
  confidence: 0.9,
});
```

**Storage Structure:**

```
.construct/observations/
├── index.json           ← Lightweight listing
├── vectors.json         ← Local vector index
├── obs-ts-abc123.json   ← Individual observation
└── obs-ts-def456.json
```

**Observation Categories:**
- `pattern`. Recurring themes
- `anti-pattern`. What to avoid
- `decision`. Choices made with rationale
- `insight`. New understanding
- `dependency`. Relationships discovered
- `session-summary`. Session-level distillation

### 7. Learning Feedback Loop

**Module:** `lib/intake/feedback.mjs`

```javascript
// User flags incorrect classification:
recordFeedback(rootDir, {
  intakeId: 'intake-123',
  original: { intakeType: 'bug', primaryOwner: 'engineer' },
  corrected: { intakeType: 'incident', primaryOwner: 'sre' },
  reason: 'wrong-owner',
});

// Accuracy metrics updated:
{
  overall: { total: 150, corrected: 12, accuracy: 92.0 },
  byType: {
    'bug': { total: 52, corrected: 4, accuracy: 92.3 },
    'incident': { total: 23, corrected: 1, accuracy: 95.7 },
  }
}
```

**Keyword Adjustments** (learned from patterns):

```
Pattern detected: bug → incident (5 times)
Suggestion: Review keywords for 'bug'. frequently confused with 'incident'
```

### 8. Cross-Document Knowledge Graph

**Module:** `lib/memory/entities.mjs`

```javascript
// Entities tracked:
createEntities([
  {
    name: 'session-management',
    type: 'component',
    observationIds: ['obs-1', 'obs-2', 'obs-3'],
    summary: 'Authentication session handling system',
  },
  {
    name: 'authentication',
    type: 'service',
    observationIds: ['obs-1'],
    summary: 'User authentication service',
  },
]);
```

**Query:** "What do we know about session-management?"

```
Results:
┌─────────────────────────────────────────────────────────────┐
│ Entity: session-management                                  │
│ Type: component                                             │
│                                                             │
│ Connected Documents:                                        │
│   - .construct/knowledge/internal/adr-session-management.md       │
│   - inbox/session-timeout-bug-20260517.md                  │
│   - inbox/login-feedback-20260518.md                       │
│                                                             │
│ Related Observations:                                       │
│   - obs-1: Login friction increases support volume 40%     │
│   - obs-2: Implement sliding session with warning          │
│   - obs-3: Fixed TTL sessions cause data loss              │
└─────────────────────────────────────────────────────────────┘
```

## Complete Flow Diagram

```
┌──────────────┐
│   SIGNAL     │  User drops file in inbox/
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  CLASSIFY    │  lib/intake/classify.mjs (deterministic, no LLM)
│              │  → intakeType, rdStage, primaryOwner, chain
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   RETRIEVE   │  lib/storage/hybrid-query.mjs
│              │  → BM25 + Vector → Top-K related docs
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   DISPATCH   │  lib/orchestration-policy.mjs
│              │  → Select Worker Profiles, identify parallel checks
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   EXECUTE    │  lib/worker/run.mjs
│              │  → Bounded execution, evidence capture
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   EVIDENCE   │  .construct/task-graphs/<id>.json
│              │  → Node transitions: pending → done
└──────┬───────┘
       │
       ▼
┌──────────────┐
│    LEARN     │  lib/observation-store.mjs
│              │  → Store patterns, decisions, anti-patterns
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   CONNECT    │  lib/memory/entities.mjs
│              │  → Link observations to components/services
└──────────────┘
```

## CLI Commands

```bash
# View pending intake
construct intake list

# Show intake details
construct intake show <id>

# Mark intake as done
construct intake done <id> --notes="Implemented in PR #123"

# Record classification feedback
construct feedback:record --intake=<id> --corrected='{"intakeType":"incident"}'

# View feedback history
construct feedback:history --limit=20

# View classification accuracy
construct feedback:record --json

# List available roles
construct roles:list

# View proactive activation status
construct activation:status
```

## Key Design Principles

1. **Daemon never calls LLM**. Classification is deterministic (keyword/heuristic)
2. **Agent does the analysis**. The LLM in your editor does the real thinking
3. **Evidence required**. No task transitions to `done` without evidence
4. **Everything traced**. Audit trail in `~/.construct/projects/<key>/traces/<YYYY-MM-DD>.jsonl`
5. **Degraded gracefully**. Works without Postgres, falls back to local JSON
6. **Learning loop closed**. Feedback improves classification over time

## Related Documents

- [Intake and Triage](/guides/concepts/intake-and-triage). Full taxonomy and classification table
- [Beads and State](/guides/concepts/beads-and-state). Durable state management
- [Architecture](/guides/concepts/architecture). System overview
- [Org Chart](/guides/concepts/org-chart). Worker Profile roster
