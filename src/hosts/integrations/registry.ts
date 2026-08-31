/**
 * hosts/integrations/registry.ts — known HostIntegrationAdapters by client id.
 */

import type { HostIntegrationAdapter } from '../../kernel/integration/types.ts';
import { createCursorIntegrationAdapter } from './cursor.ts';
import { createClaudeCodeIntegrationAdapter } from './claude-code.ts';
import { createUnsupportedIntegrationAdapter } from './unsupported.ts';

export function integrationAdapterFor(client: string): HostIntegrationAdapter | null {
  switch (client) {
    case 'cursor':
      return createCursorIntegrationAdapter();
    case 'claude':
    case 'claude-code':
      return createClaudeCodeIntegrationAdapter();
    case 'opencode':
    case 'bob':
    case 'vscode':
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
    createUnsupportedIntegrationAdapter('opencode'),
    createUnsupportedIntegrationAdapter('bob'),
    createUnsupportedIntegrationAdapter('vscode'),
    createUnsupportedIntegrationAdapter('codex'),
  ];
}
