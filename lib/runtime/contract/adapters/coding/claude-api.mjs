/**
 * lib/runtime/contract/adapters/coding/claude-api.mjs — Claude Messages API runtime.
 *
 * The "after" side of this bead's replacement proof (see claude-cli.mjs for
 * the "before"): same runtime contract, same 'coding' kind, same request
 * shape ({ prompt }), transport swapped from a `claude` CLI subprocess to a
 * direct HTTPS call against Anthropic's Messages API via fetch — the
 * runtime-adapter-layer equivalent of spike F's gh-CLI-to-REST provider swap
 * (docs/notes/research/workspace-control-plane/synthesis/spike-f-runtime-replacement.md).
 * Unlike the CLI transport, an in-flight call can be interrupted by aborting
 * the underlying fetch, no process signal needed.
 *
 * `request.input.system` is optional and, when present, is sent as the
 * Messages API's top-level `system` parameter rather than folded into the
 * user turn — the model loop needs this to
 * preserve the system/user separation the ad hoc call sites it replaces
 * already relied on (lib/intent-classifier.mjs, lib/schema-infer.mjs).
 * A completed RuntimeResult also carries an optional `usage` field
 * ({ inputTokens, outputTokens }) when the API response includes one — an
 * additive field beyond the interface's required {id,status,output,error},
 * needed so migrated call sites keep reporting cost telemetry.
 *
 * `fetchFn` defaults to the global fetch; tests inject a fake to avoid a
 * real network call, mirroring process-transport.mjs's spawnFn DI.
 */
import { randomUUID } from 'node:crypto';
import { RuntimeNotReadyError, InvocationError } from '../../errors.mjs';

const DEFAULT_API_BASE = 'https://api.anthropic.com';
const DEFAULT_MODEL = 'claude-sonnet-4-5';
const DEFAULT_MAX_TOKENS = 1024;

export function createClaudeApiRuntime({
  name = 'claude-api',
  apiKey,
  apiBase = DEFAULT_API_BASE,
  model = DEFAULT_MODEL,
  fetchFn = fetch,
} = {}) {
  let ready = false;
  let resolvedKey = apiKey;
  const inFlight = new Map();

  return {
    name,
    kind: 'coding',
    capabilities: ['interrupt'],

    async init(config = {}) {
      resolvedKey = config.apiKey ?? resolvedKey ?? process.env.ANTHROPIC_API_KEY;
      ready = true;
    },

    async health() {
      return { live: ready };
    },

    async invoke(request, context = {}) {
      if (!ready) throw new RuntimeNotReadyError(name);
      const invocationId = context.invocationId ?? randomUUID();
      const controller = new AbortController();
      inFlight.set(invocationId, controller);

      try {
        const res = await fetchFn(`${apiBase}/v1/messages`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'x-api-key': resolvedKey ?? '',
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model,
            max_tokens: request?.input?.maxTokens ?? DEFAULT_MAX_TOKENS,
            ...(request?.input?.system ? { system: String(request.input.system) } : {}),
            messages: [{ role: 'user', content: String(request?.input?.prompt ?? '') }],
          }),
        });

        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          return {
            id: invocationId,
            status: 'failed',
            output: null,
            error: new InvocationError(`Anthropic API ${res.status}: ${detail}`, {
              runtime: name,
              code: `HTTP_${res.status}`,
            }),
          };
        }

        const body = await res.json();
        const text = (body.content ?? []).map((block) => block.text ?? '').join('');
        const usage = body.usage
          ? { inputTokens: body.usage.input_tokens ?? 0, outputTokens: body.usage.output_tokens ?? 0 }
          : undefined;
        return { id: invocationId, status: 'completed', output: text, error: null, ...(usage ? { usage } : {}) };
      } catch (err) {
        if (controller.signal.aborted) {
          return { id: invocationId, status: 'cancelled', output: null, error: null };
        }
        return {
          id: invocationId,
          status: 'failed',
          output: null,
          error: new InvocationError(err.message, { runtime: name, cause: err }),
        };
      } finally {
        inFlight.delete(invocationId);
      }
    },

    async cancel(invocationId) {
      const controller = inFlight.get(invocationId);
      if (!controller) return { cancelled: false, reason: 'unknown invocation id' };
      controller.abort();
      return { cancelled: true };
    },
  };
}
