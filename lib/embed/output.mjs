/**
 * lib/embed/output.mjs — snapshot output dispatcher.
 *
 * Routes a rendered snapshot to one or more configured output targets:
 *   - markdown: write to a file
 *   - slack:    post to a channel via the slack provider
 *   - log:      print to stdout (default / fallback)
 */

import fs from 'node:fs';
import path from 'node:path';
import { renderMarkdown } from './snapshot.mjs';

/**
 * Dispatch a snapshot to all configured outputs.
 * @param {object} snapshot     - Raw snapshot object from SnapshotEngine
 * @param {object[]} outputs    - Output configs from embed config
 * @param {ProviderRegistry} registry
 */
export async function dispatchOutputs(snapshot, outputs, registry) {
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
