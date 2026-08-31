/**
 * kernel/execution/types.ts — ExecutionAdapter seam (headless / spawned work).
 *
 * Distinct from HostIntegrationAdapter. Must not write host MCP/skill installs.
 */

export type ExecutionCapability =
  | 'interrupt'
  | 'stream'
  | 'sandbox'
  | 'concurrent'
  | 'outward-write'
  | 'role-write';

export interface ExecutionCapabilities {
  readonly capabilities: readonly ExecutionCapability[];
  readonly maturity: 'documented' | 'measured' | 'conformance-tested' | 'unsupported' | 'unknown';
}

export interface ExecutionResult {
  readonly ok: boolean;
  readonly output?: unknown;
  readonly error?: unknown;
  readonly spend?: number;
  readonly spendReported?: boolean;
}

export interface ExecutionHealth {
  readonly ok: boolean;
  readonly detail?: string;
}

export interface Cancellation {
  readonly ok: boolean;
  readonly detail?: string;
}

/**
 * Something Construct deliberately invokes outside an active interactive session,
 * or under an explicit cross-host override.
 */
export interface ExecutionAdapter {
  readonly id: string;
  readonly capabilities: ExecutionCapabilities;
  init(opts: { readonly cwd: string; readonly model?: string }): Promise<void>;
  invoke(opts: {
    readonly prompt: string;
    readonly cwd: string;
    readonly model?: string;
    readonly timeoutMs?: number;
  }): Promise<ExecutionResult>;
  health(): Promise<ExecutionHealth>;
  cancel(opts?: { readonly reason?: string }): Promise<Cancellation>;
}
