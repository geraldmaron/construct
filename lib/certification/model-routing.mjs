/**
 * lib/certification/model-routing.mjs — OpenRouter free-first certification model routing.
 *
 * Default selection resolves to OpenRouter free-tier models. Paid reference models
 * require CONSTRUCT_CERTIFY_ALLOW_PAID=1 and optional CONSTRUCT_CERTIFY_BUDGET_USD
 * cap; without explicit opt-in the paid path fails closed and never executes a call.
 */

export const PAID_OPT_IN_ENV = 'CONSTRUCT_CERTIFY_ALLOW_PAID';
export const PAID_BUDGET_ENV = 'CONSTRUCT_CERTIFY_BUDGET_USD';

export const CERTIFICATION_MODEL_ROUTES = Object.freeze([
  {
    id: 'openrouter/free-auto',
    provider: 'openrouter',
    resolvedId: 'openrouter/openrouter/free',
    tier: 'free',
    label: 'OpenRouter free router',
  },
  {
    id: 'openrouter/meta-llama/llama-3.3-70b-instruct:free',
    provider: 'openrouter',
    resolvedId: 'openrouter/meta-llama/llama-3.3-70b-instruct:free',
    tier: 'free',
    label: 'Llama 3.3 70B (free)',
  },
  {
    id: 'openrouter/qwen/qwen-2.5-72b-instruct:free',
    provider: 'openrouter',
    resolvedId: 'openrouter/qwen/qwen-2.5-72b-instruct:free',
    tier: 'free',
    label: 'Qwen 2.5 72B (free)',
  },
  {
    id: 'anthropic/claude-sonnet-4',
    provider: 'openrouter',
    resolvedId: 'openrouter/anthropic/claude-sonnet-4',
    tier: 'paid-reference',
    label: 'Claude Sonnet 4 (paid reference)',
    referenceCostUsd: 0.05,
  },
  {
    id: 'openai/gpt-4o',
    provider: 'openrouter',
    resolvedId: 'openrouter/openai/gpt-4o',
    tier: 'paid-reference',
    label: 'GPT-4o (paid reference)',
    referenceCostUsd: 0.08,
  },
]);

function routeById(requestedId) {
  return CERTIFICATION_MODEL_ROUTES.find(
    (entry) => entry.id === requestedId || entry.resolvedId === requestedId,
  );
}

export function paidOptInEnabled(env = process.env) {
  return env[PAID_OPT_IN_ENV] === '1';
}

export function readPaidBudgetUsd(env = process.env) {
  const raw = env[PAID_BUDGET_ENV];
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function listCertificationModels({ env = process.env, includePaid = paidOptInEnabled(env) } = {}) {
  return CERTIFICATION_MODEL_ROUTES.filter((route) => includePaid || route.tier !== 'paid-reference');
}

export function resolveCertificationModel(scenarioModel = {}, { env = process.env, now = () => new Date().toISOString() } = {}) {
  const requestedId = scenarioModel.requestedId ?? scenarioModel.resolvedId ?? 'openrouter/free-auto';
  const route = routeById(requestedId);
  const tier = route?.tier ?? scenarioModel.tier ?? 'unknown';
  const resolvedId = route?.resolvedId ?? scenarioModel.resolvedId ?? requestedId;
  const provider = route?.provider ?? scenarioModel.provider ?? 'openrouter';

  if (tier === 'hermetic') {
    return {
      provider,
      requestedId,
      resolvedId,
      tier,
      paidOptIn: false,
      operatorAckAt: null,
      blocked: false,
      blockReason: null,
    };
  }

  if (tier === 'paid-reference') {
    if (!paidOptInEnabled(env)) {
      return {
        provider,
        requestedId,
        resolvedId,
        tier,
        paidOptIn: false,
        operatorAckAt: null,
        blocked: true,
        blockReason: `${PAID_OPT_IN_ENV}=1 required for paid-reference models`,
      };
    }
    const budget = readPaidBudgetUsd(env);
    const referenceCost = route?.referenceCostUsd ?? null;
    if (budget != null && referenceCost != null && referenceCost > budget) {
      return {
        provider,
        requestedId,
        resolvedId,
        tier,
        paidOptIn: true,
        operatorAckAt: now(),
        blocked: true,
        blockReason: `reference cost ${referenceCost} USD exceeds ${PAID_BUDGET_ENV}=${budget}`,
      };
    }
    return {
      provider,
      requestedId,
      resolvedId,
      tier,
      paidOptIn: true,
      operatorAckAt: now(),
      blocked: false,
      blockReason: null,
    };
  }

  return {
    provider,
    requestedId,
    resolvedId,
    tier: tier === 'unknown' ? 'free' : tier,
    paidOptIn: false,
    operatorAckAt: null,
    blocked: false,
    blockReason: null,
  };
}

export function formatModelRoutingSummary(model) {
  const tier = model?.tier ?? 'unknown';
  const resolved = model?.resolvedId ?? model?.requestedId ?? 'unknown';
  const optIn = model?.paidOptIn === true ? ' paid-opt-in' : '';
  return `model-tier: ${tier}${optIn} → ${resolved}`;
}
