/**
 * lib/embed/output.mjs — snapshot output dispatcher.
 *
 * Routes a rendered snapshot to one or more configured output targets:
 *   - markdown: write to a file
 *   - slack:    post to a channel via the slack provider (authority-guarded)
 *   - log:      print to stdout (default / fallback)
 */

import fs from 'node:fs';
import path from 'node:path';
import { renderMarkdown } from './snapshot.mjs';

/**
 * Dispatch a snapshot to all configured outputs.
 * @param {object} snapshot              - Raw snapshot object from SnapshotEngine
 * @param {object[]} outputs             - Output configs from embed config
 * @param {ProviderRegistry} registry
 * @param {AuthorityGuard} [authorityGuard] - Optional guard; if omitted, Slack posts proceed unchecked
 */
export async function dispatchOutputs(snapshot, outputs, registry, authorityGuard) {
  const markdown = renderMarkdown(snapshot);
  const results = [];

  for (const output of outputs ?? []) {
    try {
      switch (output.type) {
        case 'markdown': {
          const filePath = output.path ?? '.cx/snapshot.md';
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, markdown, 'utf8');
          results.push({ type: 'markdown', path: filePath, status: 'ok' });
          break;
        }
        case 'slack': {
          const provider = registry?.get(output.provider ?? 'slack');
          if (!provider) throw new Error(`Slack provider not registered`);

          // Authority check — Slack posts are externalPost actions
          if (authorityGuard) {
            const decision = await authorityGuard.check('externalPost', {
              description: `Snapshot post to Slack channel ${output.channel}`,
              payload: { channel: output.channel },
            });
            if (!decision.allowed) {
              results.push({
                type: 'slack',
                channel: output.channel,
                status: 'queued',
                queueId: decision.queueId,
                reason: decision.reason,
              });
              break;
            }
          }

          await provider.write({
            type: 'message',
            channel: output.channel,
            text: markdown.slice(0, 3000), // Slack message limit
          });
          results.push({ type: 'slack', channel: output.channel, status: 'ok' });
          break;
        }
        case 'log':
        default: {
          process.stdout.write(markdown + '\n');
          results.push({ type: 'log', status: 'ok' });
          break;
        }
      }
    } catch (err) {
      results.push({ type: output.type, status: 'error', error: err.message });
    }
  }

  return results;
}
