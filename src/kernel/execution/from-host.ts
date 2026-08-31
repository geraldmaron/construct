/**
 * kernel/execution/from-host.ts — adapt an existing HostAdapter into
 * ExecutionAdapter without teaching hosts about MCP install.
 *
 * The legacy HostAdapter seam still owns spawn/invoke. Clean-slate code
 * talks ExecutionAdapter; this wrapper is the bridge until host adapters
 * are rewritten against the new types.
 */

import type { HostAdapter, HostCapability } from '../hosts/interface.ts';
import type {
  Cancellation,
  ExecutionAdapter,
  ExecutionCapabilities,
  ExecutionCapability,
  ExecutionHealth,
  ExecutionResult,
} from './types.ts';

const CAPABILITY_SET = new Set<string>([
  'interrupt',
  'stream',
  'sandbox',
  'concurrent',
  'outward-write',
  'role-write',
]);

function mapCapabilities(caps: readonly HostCapability[]): ExecutionCapabilities {
  const mapped = caps.filter((c): c is ExecutionCapability => CAPABILITY_SET.has(c));
  return {
    capabilities: mapped,
    maturity: 'measured',
  };
}

/**
 * Wrap a conforming HostAdapter as an ExecutionAdapter.
 *
 * `invoke` maps the ExecutionAdapter prompt into the host request shape
 * (`role` + `task`) every shipped adapter already accepts.
 */
export function executionAdapterFromHost(host: HostAdapter): ExecutionAdapter {
  let lastInvocationId: string | null = null;

  return {
    id: host.name,
    capabilities: mapCapabilities(host.capabilities),
    async init(opts) {
      await host.init({ dir: opts.cwd, model: opts.model });
    },
    async invoke(opts): Promise<ExecutionResult> {
      const invocationId = `exec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      lastInvocationId = invocationId;
      const result = await host.invoke(
        {
          role: 'execution',
          task: opts.prompt,
          model: opts.model,
          dir: opts.cwd,
        },
        { invocationId },
      );
      return {
        ok: result.status === 'ok',
        output: result.output,
        error: result.error ?? undefined,
      };
    },
    async health(): Promise<ExecutionHealth> {
      const h = await host.health();
      return { ok: h.live, detail: h.detail };
    },
    async cancel(opts): Promise<Cancellation> {
      if (lastInvocationId === null) {
        return { ok: false, detail: opts?.reason ?? 'no in-flight invocation' };
      }
      const c = await host.cancel(lastInvocationId);
      return { ok: c.cancelled, detail: c.reason ?? opts?.reason };
    },
  };
}
