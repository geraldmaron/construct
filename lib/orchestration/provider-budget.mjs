/**
 * lib/orchestration/provider-budget.mjs — per-run USD spend ceiling for
 * provider-executed Worker Profile tasks.
 *
 * Providers do not return dollar cost on a completion response, so the budget
 * is synthetic: every call's usage tokens are priced at a deliberately
 * conservative flat rate (the same upper-bound rates as
 * tests/functional/_lib/openrouter-llm.mjs) and accumulated into one per-RUN
 * counter shared across every task in the run. The check runs after each call
 * records its usage — the call that crosses the cap completes and is paid for,
 * and the NEXT call is what gets stopped (assertWithinCap throws
 * ProviderBudgetError before any transport work).
 *
 * Configuration: CONSTRUCT_PROVIDER_BUDGET_USD_CENTS sets the cap in USD
 * cents. Unset, empty, or unparseable values take the default of 100 cents
 * ($1.00); an explicit -1 disables the ceiling entirely. This is a spend
 * ceiling, not a quality gate — there is deliberately no skip variable, only
 * a cap value.
 */

export const PROVIDER_BUDGET_ENV = 'CONSTRUCT_PROVIDER_BUDGET_USD_CENTS';
export const PROVIDER_BUDGET_DEFAULT_CENTS = 100;

// Conservative flat pricing (USD per 1K tokens), matching the upper-bound
// rates the live-LLM test harness uses: over-counting cheap models is safe,
// under-counting expensive ones is not.

const PRICE_PER_1K = { prompt: 0.005, completion: 0.015 };

export class ProviderBudgetError extends Error {
  constructor(totalCents, capCents) {
    super(
      `Provider budget cap exceeded: estimated spend ${(totalCents / 100).toFixed(2)} USD > cap ${(capCents / 100).toFixed(2)} USD (${PROVIDER_BUDGET_ENV}).`,
    );
    this.name = 'ProviderBudgetError';
    this.code = 'PROVIDER_BUDGET_EXCEEDED';
    this.totalCents = totalCents;
    this.capCents = capCents;
    this.remediation = `Raise ${PROVIDER_BUDGET_ENV} (cents; -1 disables), or re-run with worker_backend "host" — the calling agent executes each Worker Profile prompt in its own session at no API cost.`;
    this.retryable = false;
  }
}

export function resolveBudgetCapCents(env = process.env) {
  const raw = env?.[PROVIDER_BUDGET_ENV];
  if (raw === undefined || raw === null || String(raw).trim() === '') return PROVIDER_BUDGET_DEFAULT_CENTS;
  const parsed = Number(String(raw).trim());
  if (parsed === -1) return -1;
  if (!Number.isFinite(parsed) || parsed < 0) return PROVIDER_BUDGET_DEFAULT_CENTS;
  return Math.floor(parsed);
}

// Usage arrives in two shapes: the worker's normalized meta.usage
// ({promptTokens, completionTokens}) and raw provider bodies
// ({prompt_tokens, completion_tokens}). Both are accepted so certification
// call sites can record a raw response body without re-normalizing.

function usageTokens(usage) {
  if (!usage || typeof usage !== 'object') return { prompt: 0, completion: 0 };
  return {
    prompt: Number(usage.promptTokens ?? usage.prompt_tokens ?? 0) || 0,
    completion: Number(usage.completionTokens ?? usage.completion_tokens ?? 0) || 0,
  };
}

/**
 * Create a per-run budget accumulator. `record(usage)` adds one call's
 * estimated cost; `assertWithinCap()` throws ProviderBudgetError once the
 * running total exceeds the cap (call it before dispatching the next provider
 * call). A cap of -1 disables both.
 */
export function createProviderBudget({ env = process.env } = {}) {
  const capCents = resolveBudgetCapCents(env);
  const disabled = capCents === -1;
  let totalCents = 0;
  let calls = 0;

  return {
    capCents,
    disabled,
    totalCents: () => totalCents,
    calls: () => calls,
    exceeded: () => !disabled && totalCents > capCents,
    record(usage) {
      const { prompt, completion } = usageTokens(usage);
      totalCents += Math.ceil(((prompt / 1000) * PRICE_PER_1K.prompt + (completion / 1000) * PRICE_PER_1K.completion) * 100);
      calls += 1;
      return totalCents;
    },
    assertWithinCap() {
      if (!disabled && totalCents > capCents) throw new ProviderBudgetError(totalCents, capCents);
    },
    snapshot() {
      return { capCents, disabled, estimatedCents: totalCents, calls, exceeded: !disabled && totalCents > capCents };
    },
  };
}
