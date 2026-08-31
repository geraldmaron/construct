/**
 * kernel/integration/types.ts — HostIntegrationAdapter seam.
 *
 * Install/reconcile/verify host MCP + skills. Never calls an LLM.
 * Distinct from ExecutionAdapter (headless run / cancel).
 */

export type IntegrationCapability =
  | 'mcp-stdio'
  | 'project-skills'
  | 'user-skills'
  | 'session-binding'
  | 'config-merge';

export interface HostIntegrationCapabilities {
  readonly capabilities: readonly IntegrationCapability[];
  /** documented | measured | conformance-tested | unsupported | unknown */
  readonly maturity: 'documented' | 'measured' | 'conformance-tested' | 'unsupported' | 'unknown';
}

export interface IntegrationStateView {
  readonly hostId: string;
  readonly status: 'installed' | 'absent' | 'broken' | 'unknown';
  readonly path?: string;
  readonly detail?: string;
}

export interface IntegrationPlan {
  readonly hostId: string;
  readonly actions: readonly {
    readonly kind: 'write-mcp' | 'write-skill' | 'skip' | 'report';
    readonly path: string;
    readonly reason: string;
  }[];
}

export interface IntegrationVerification {
  readonly ok: boolean;
  readonly checks: readonly { readonly name: string; readonly ok: boolean; readonly detail?: string }[];
}

/**
 * Native interactive integration for one client (claude-code, cursor, …).
 * Must not call an LLM or mutate task/run state beyond recording fingerprints.
 */
export interface HostIntegrationAdapter {
  readonly id: string;
  inspect(projectRoot: string): Promise<IntegrationStateView>;
  plan(projectRoot: string): Promise<IntegrationPlan>;
  install(projectRoot: string): Promise<void>;
  verify(projectRoot: string): Promise<IntegrationVerification>;
  resolveProjectRoot(hints: {
    readonly cwd?: string;
    readonly hostProvidedRoot?: string;
  }): Promise<string>;
  capabilities(): HostIntegrationCapabilities;
}
