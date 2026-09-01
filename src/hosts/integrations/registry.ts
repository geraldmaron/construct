/**
 * hosts/integrations/registry.ts — known HostIntegrationAdapters by client id.
 */

import type { HostIntegrationAdapter } from '../../kernel/integration/types.ts';
import { createCursorIntegrationAdapter } from './cursor.ts';
import { createClaudeCodeIntegrationAdapter } from './claude-code.ts';
import { createVscodeIntegrationAdapter } from './vscode.ts';
import { createOpencodeIntegrationAdapter } from './opencode.ts';
import { createUnsupportedIntegrationAdapter } from './unsupported.ts';

/** True when install() is safe to call (not a report-only stub). */
export function integrationIsInstallable(adapter: HostIntegrationAdapter): boolean {
  const maturity = adapter.capabilities().maturity;
  return maturity !== 'unsupported' && maturity !== 'unknown';
}

export function integrationAdapterFor(client: string): HostIntegrationAdapter | null {
  switch (client) {
    case 'cursor':
      return createCursorIntegrationAdapter();
    case 'claude':
    case 'claude-code':
      return createClaudeCodeIntegrationAdapter();
    case 'vscode':
    case 'vs-code':
      return createVscodeIntegrationAdapter();
    case 'opencode':
      return createOpencodeIntegrationAdapter();
    case 'bob':
    case 'codex':
    case 'goose':
    case 'pi':
      return createUnsupportedIntegrationAdapter(client);
    default:
      return null;
  }
}

export function allIntegrationAdapters(): HostIntegrationAdapter[] {
  return [
    createCursorIntegrationAdapter(),
    createClaudeCodeIntegrationAdapter(),
    createVscodeIntegrationAdapter(),
    createOpencodeIntegrationAdapter(),
    createUnsupportedIntegrationAdapter('bob'),
    createUnsupportedIntegrationAdapter('codex'),
  ];
}
