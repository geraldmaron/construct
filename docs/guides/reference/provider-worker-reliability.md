<!--
docs/guides/reference/provider-worker-reliability.md: Failure modes and
remediation for the provider-backed orchestration worker (construct-5wkl).

Covers typed error codes, retry/fallback policy, provider telemetry, evidence
grounding, and why a free OpenRouter model is not a stable release gate.
-->

# Provider worker reliability

The `provider` worker backend (`orchestration.workerBackend: 'provider'`, ADR-0021) executes each Worker Profile Assignment by calling a real model. A `2xx` HTTP response from the provider is transport success, not task success — the body can still carry an empty answer, a content-policy refusal, or a reasoning-only response with nothing in the visible channel. This page documents how `lib/orchestration/worker.mjs` classifies every outcome, what retries, and what a host or operator should do about each failure mode.

## Typed error codes

Every failure — transport or content-shaped — surfaces as one of these codes on `task.error.code` (and, for a thrown error the caller does not catch, `err.code`):

| Code | Meaning | Retried automatically? | Remediation |
|---|---|---|---|
| `PROVIDER_RATE_LIMITED` | HTTP 429 | Yes, bounded | Wait and retry, or switch tiers/providers. Free-tier OpenRouter accounts share one rate-limit budget across every `:free` model — swapping to a different `:free` id does not avoid it. |
| `PROVIDER_SERVER_ERROR` | HTTP 5xx | Yes, bounded | Retry later or switch providers; the upstream provider is degraded, not Construct. |
| `PROVIDER_TIMEOUT` | No response within `CONSTRUCT_PROVIDER_TIMEOUT_MS` | Yes, bounded | Raise the timeout for a slow/reasoning-heavy model, or switch providers. |
| `PROVIDER_AUTH_ERROR` | HTTP 401/403 | No | Rotate or re-authenticate the credential; retrying will not change the outcome. |
| `PROVIDER_CONTENT_FILTERED` | `finish_reason`/`stop_reason` indicates a content-policy refusal | No | Rephrase the task or route it to a different model. |
| `PROVIDER_EMPTY_CONTENT` | 2xx response, no text in any expected field | No | Retry, or switch providers/models — the request reached the provider but produced nothing usable. |
| `PROVIDER_REASONING_ONLY` | Reasoning/thinking content is non-empty but the visible answer is empty, with a length/`max_tokens` finish reason | No | The worker already reserves extra output budget when reasoning is requested (see below) specifically to prevent this; if it still recurs, raise the output-token ceiling for that model. |
| `PROVIDER_MALFORMED_RESPONSE` | 2xx response missing the expected `choices[0].message` / `content` shape | No | Retry, or check whether the provider changed its response shape. |
| `PROVIDER_EXECUTION_FAILED` | Any other non-2xx status | No | Verify the model id and API key, or set `orchestration.workerBackend` to `inline`. |
| `PROVIDER_KEY_MISSING` / `PROVIDER_MODEL_UNRESOLVED` / `PROVIDER_NO_FETCH` | Preflight failures before any network call | No | Configure the missing credential/model/runtime — these never reach the provider. |

A task that fails for any of these reasons is recorded `status: 'failed'` with `task.error.code`/`message`/`remediation` — never `status: 'done'` with hollow output. The run completes `completed-with-failures` rather than crashing (unchanged from ADR-0021).

## Retry and fallback policy

Only the three genuinely transient, infrastructure-level codes retry: `PROVIDER_RATE_LIMITED`, `PROVIDER_SERVER_ERROR`, `PROVIDER_TIMEOUT`. A content-policy refusal, an auth failure, or a malformed response will not change on retry, so none of them are retried.

- `CONSTRUCT_PROVIDER_MAX_ATTEMPTS` (default `3`): total attempts, including the first.
- `CONSTRUCT_PROVIDER_RETRY_BASE_MS` (default `250`): base backoff in milliseconds; doubles per attempt (250 → 500 → …).
- `CONSTRUCT_PROVIDER_TIMEOUT_MS` (default `120000`): per-attempt timeout.

`construct doctor` prints the effective values of all three so a stale or unintentionally test-scale override is never invisible.

When every attempt is exhausted, the final error's code, message, and retry count ride on `task.error` — the full chain is preserved, not replaced with a generic message.

## Provider telemetry

Every provider-executed task (success or content-shaped failure) carries redacted `task.providerMeta`:

```json
{
  "provider": "openrouter",
  "model": "openrouter/qwen/qwen3-coder:free",
  "finishReason": "stop",
  "nativeFinishReason": "STOP",
  "usage": { "promptTokens": 120, "completionTokens": 340, "totalTokens": 460 },
  "elapsedMs": 842,
  "retryCount": 1,
  "reasoningRequested": false,
  "reasoningReturned": false
}
```

No prompt or completion text, and no credential, ever appears in this object — only the shape needed to debug why a task behaved the way it did without re-running it.

## Reasoning mode and token starvation

Requesting reasoning (`chainOfThought !== 'hidden'`) reserves extra output-token budget on top of the base ceiling, on every provider family that supports reasoning:

- **Anthropic**: extended-thinking `budget_tokens` (or adaptive thinking on newer models) is added on top of `max_tokens`, per Anthropic's own requirement that thinking budget stay under the turn's total ceiling.
- **OpenRouter**: `max_tokens` is raised the same way when `reasoning.enabled` is set, because OpenRouter charges reasoning tokens against the same completion budget as the visible answer. Without that headroom, a reasoning-heavy model can spend the entire budget on reasoning and return empty visible content — the exact failure this bead's live validation observed. If a reasoning-only response still occurs (`PROVIDER_REASONING_ONLY`), the fix is a larger output-token ceiling for that specific model, not a retry.

## Evidence grounding for web-capable Worker Profiles

A web-capable Worker Profile's only *observed* evidence is its own governed `webEvidence` (ADR-0050: every result trust-labeled `untrusted` + Admiralty-graded before the model ever sees it). After the model answers, the worker extracts every URL the answer cites and compares it against `webEvidence`. A citation absent from that list was never actually retrieved through Construct's governed path — it is either fabricated outright or recalled from the model's own ungoverned training memory.

The task is not failed for this — the output is real, already-paid-for model work — but it carries:

- `task.evidenceStatus: 'unverified-citations'`
- `task.unverifiedCitations: [...]` — the specific URLs that do not trace to governed evidence

A host or reviewer should treat an `unverified-citations` task as downgraded evidence: present it as a claim to verify, not as a sourced fact. This check currently covers the single-shot web paths (governed tool-use loop, provider-native web search, and the honest no-web fallback); it does not yet re-verify claims that cite non-URL evidence (file paths, quoted figures) — that is a larger, separately-scoped grounding problem.

## Why a free OpenRouter model is not a stable release gate

OpenRouter's free tier (`:free`-suffixed model ids) enforces a shared rate-limit budget per account across *every* `:free` model, not per individual model — pinning a different free model does not avoid a 429, because the underlying constraint is the account's own request budget, not a property of any one model. Free models are also retired, renamed, or individually rate-limited by their upstream provider without notice (`construct-r7bp` tracks catalog staleness). A release gate, CI check, or acceptance test that depends on a live call to a free OpenRouter model will flake on exactly the conditions this document exists to handle — a 429, a timeout, or an empty/reasoning-only response are all *expected*, periodic behavior for a free-tier account under load, not bugs. Gate provider-backed behavior against a mocked `fetchImpl` (as every test referenced below does); reserve a live free-model call for manual, best-effort validation, never for a required pass/fail signal.

## Tests

- `tests/orchestration-provider-outcome.test.mjs` — classification, retry, and citation-grounding unit tests.
- `tests/orchestration-worker.test.mjs` — integration coverage for 429, 5xx, timeout, empty content, reasoning-only, `finish_reason=length`/`content_filter`, malformed choices, and successful retry.
- `tests/orchestration-worker-web.test.mjs` — evidence-grounding coverage for the web-capable path.
- `tests/functional/gate-worker-backend-visibility.functional.test.mjs` — `construct doctor` surfaces the effective timeout/retry settings.
