/**
 * hosts/integrations/registry.ts — known HostIntegrationAdapters by client id.
 */

import type { HostIntegrationAdapter } from '../../kernel/integration/types.ts';
import { createCursorIntegrationAdapter } from './cursor.ts';
import { createClaudeCodeIntegrationAdapter } from './claude-code.ts';
import { createVscodeIntegrationAdapter } from './vscode.ts';
import { createUnsupportedIntegrationAdapter } from './unsupported.ts';

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
    createUnsupportedIntegrationAdapter('opencode'),
    createUnsupportedIntegrationAdapter('bob'),
    createUnsupportedIntegrationAdapter('codex'),
  ];
}
