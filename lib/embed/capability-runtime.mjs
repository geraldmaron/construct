/**
 * lib/embed/capability-runtime.mjs — runtime selector resolution.
 *
 * Resolves an embed capability's `runtime` field (`in-process` | `external`
 * | `auto` | `none`) to the runtime that will actually execute reasoning,
 * without performing that reasoning. `auto` resolves to `in-process` when a
 * model provider is configured (the existing model-resolution path,
 * lib/model-router.mjs `readCurrentModels`), else `external` when an
 * external host is configured (`CONSTRUCT_EXTERNAL_AGENT_HOST`), else
 * `none`. `none` is an honest, visible skip — never a fabricated result —
 * per the workflow-invoke.mjs no-fabrication invariant this ADR preserves.
 */

export const SKIP_REASON_NO_RUNTIME = 'no-runtime';

/**
 * True when the existing model-resolution path has a model configured for
 * any tier. Reuses lib/model-router.mjs so this module adds no new
 * dependency — it is a read-only probe of state Construct already resolves.
 */
async function hasConfiguredModelProvider(env) {
  try {
    const { readCurrentModels } = await import('../model-router.mjs');
    const models = readCurrentModels(null, {}, env);
    return Boolean(models?.fast || models?.standard || models?.reasoning);
  } catch {
    return false;
  }
}

function hasExternalRuntimeConfigured(env) {
  return Boolean((env.CONSTRUCT_EXTERNAL_AGENT_HOST ?? '').trim());
}

/**
 * Resolve the declared `runtime` selector to the runtime that will actually
 * execute reasoning.
 *
 * @param {'in-process'|'external'|'auto'|'none'} runtime
 * @param {object} [env] - env object (default: process.env)
 * @returns {Promise<{ resolved: 'in-process'|'external'|'none', reason?: string }>}
 */
export async function resolveRuntime(runtime, env = process.env) {
  if (runtime === 'in-process') return { resolved: 'in-process' };
  if (runtime === 'external') {
    if (!hasExternalRuntimeConfigured(env)) {
      return { resolved: 'none', reason: SKIP_REASON_NO_RUNTIME };
    }
    return { resolved: 'external' };
  }
  if (runtime === 'none') return { resolved: 'none', reason: SKIP_REASON_NO_RUNTIME };

  // auto: in-process if a model provider is configured, else external if a
  // host is configured, else none.
  if (await hasConfiguredModelProvider(env)) return { resolved: 'in-process' };
  if (hasExternalRuntimeConfigured(env)) return { resolved: 'external' };
  return { resolved: 'none', reason: SKIP_REASON_NO_RUNTIME };
}
