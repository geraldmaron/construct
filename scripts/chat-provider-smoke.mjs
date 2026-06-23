#!/usr/bin/env node

/**
 * scripts/chat-provider-smoke.mjs — provider configuration check and smoke test guide.
 *
 * Verifies provider credentials and suggests validation next steps. Usage:
 *   node scripts/chat-provider-smoke.mjs
 */

import { dirname, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConstructEnv } from '../lib/env-config.mjs';
import { getProviderModelCatalog } from '../lib/model-router.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = pathResolve(HERE, '..');

async function main() {
  const env = loadConstructEnv({ rootDir: ROOT, env: process.env, warn: false });

  console.log('🧪 Construct chat provider configuration check\n');

  const { providers: catalogProviders } = getProviderModelCatalog({ env });
  const byProvider = new Map();

  for (const p of catalogProviders) {
    byProvider.set(p.id, p);
  }

  const providers = ['anthropic', 'openrouter', 'github-copilot', 'ollama'];
  const results = [];

  for (const provider of providers) {
    const entry = byProvider.get(provider);
    const configured = entry?.configured ?? false;
    const models = entry?.models ?? [];
    if (!configured) {
      console.log(`· ${provider.padEnd(16)} not configured`);
      results.push({ provider, status: 'unconfigured' });
    } else {
      console.log(`✓ ${provider.padEnd(16)} ${models.length} model${models.length === 1 ? '' : 's'} available`);
      for (const m of models.slice(0, 2)) {
        console.log(`  - ${m.id ?? m}`);
      }
      if (models.length > 2) {
        console.log(`  + ${models.length - 2} more`);
      }
      results.push({ provider, status: 'configured', count: models.length });
    }
  }

  const configuredCount = results.filter((r) => r.status === 'configured').length;
  console.log(`\n${configuredCount}/${providers.length} providers configured\n`);

  if (configuredCount === 0) {
    console.log('To enable a provider, set credentials in ~/.construct/config.env:');
    console.log('  ANTHROPIC_API_KEY=...');
    console.log('  OPENROUTER_API_KEY=...');
    console.log('  GITHUB_TOKEN=...');
    console.log('  OLLAMA_BASE_URL=http://localhost:11434\n');
  }

  console.log('To validate a provider end-to-end, run:');
  console.log('  construct chat --model <provider>/<model-id>\n');
  console.log('For automated tests, see: tests/functional/chat-providers.functional.test.mjs\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
