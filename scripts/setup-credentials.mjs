/**
 * scripts/setup-credentials.mjs — link missing LLM API keys from 1Password.
 *
 * Optional, manually run (`node scripts/setup-credentials.mjs`). The env prep is a
 * presence-check only (autoLink omitted) so the single autoLink+force call below is
 * the one place `op item list` runs — one 1Password round-trip per invocation.
 */

import { prepareConstructEnv } from '../lib/runtime-env.mjs';
import { formatCredentialBootstrapNotice } from '../lib/providers/credential-bootstrap.mjs';
import { getUserEnvPath } from '../lib/env-config.mjs';

prepareConstructEnv({ warn: false });
const { ensureConstructCredentials } = await import('../lib/providers/credential-bootstrap.mjs');
const result = ensureConstructCredentials({ force: true, autoLink: true });
const notice = formatCredentialBootstrapNotice(result);
if (notice) console.log(notice);
else console.log(`Credentials ready (${getUserEnvPath()})`);
