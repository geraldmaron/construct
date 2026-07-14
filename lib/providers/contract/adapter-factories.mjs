/**
 * lib/providers/contract/adapter-factories.mjs — the single registry of
 * governed-write adapter factories, shared by every caller that resolves a
 * provider by name (lib/writes/control-plane.mjs's drain,
 * lib/mcp/tools/provider-write.mjs's MCP tool). Adding a governed provider
 * means adding one entry here, not editing every caller.
 *
 * Real transports read credentials from process.env at construction time;
 * github's transport is the gh CLI, already credential-free at construction.
 * Building the transport lazily per call (rather than once at module load)
 * keeps a missing-credential AuthError scoped to the one call that needed it.
 */

import { createGovernedJiraProvider } from './adapters/jira/governed-write.mjs';
import { createJiraTransport } from './adapters/jira/transport.mjs';
import { createGovernedConfluenceProvider } from './adapters/confluence/governed-write.mjs';
import { createConfluenceTransport } from './adapters/confluence/transport.mjs';
import { createGovernedGithubProvider } from './adapters/github/governed-write.mjs';
import githubAdapter from './adapters/github/index.mjs';
import { createGovernedSlackProvider } from './adapters/slack/governed-write.mjs';
import { createSlackTransport } from './adapters/slack/transport.mjs';

export const DEFAULT_ADAPTER_FACTORIES = Object.freeze({
  jira: () => createGovernedJiraProvider({ jiraTransport: createJiraTransport() }),
  confluence: () => createGovernedConfluenceProvider({ confluenceTransport: createConfluenceTransport() }),
  github: () => createGovernedGithubProvider({ ghAdapter: githubAdapter }),
  slack: () => createGovernedSlackProvider({ slackTransport: createSlackTransport() }),
});

/**
 * Resolve the governed-write adapter for a provider name.
 *
 * @param {string} provider
 * @param {Record<string, () => object>} [factories] - override (tests)
 * @returns {{ meta: object, write: Function, search?: Function, renderDryRun?: Function }}
 */
export function resolveGovernedAdapter(provider, factories = DEFAULT_ADAPTER_FACTORIES) {
  const factory = factories[provider];
  if (!factory) {
    const known = Object.keys(factories).join(', ');
    throw new Error(`resolveGovernedAdapter: unknown provider "${provider}" (known: ${known})`);
  }
  return factory();
}
