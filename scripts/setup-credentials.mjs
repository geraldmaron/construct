/**
 * scripts/setup-credentials.mjs — link missing LLM API keys from 1Password.
 *
 * `construct` runs this automatically at startup; this script is optional.
 */

import { prepareConstructEnv } from '../lib/runtime-env.mjs';
import { formatCredentialBootstrapNotice } from '../lib/providers/credential-bootstrap.mjs';
import { getUserEnvPath } from '../lib/env-config.mjs';

prepareConstructEnv({ warn: false, autoLink: true });
const { ensureConstructCredentials } = await import('../lib/providers/credential-bootstrap.mjs');
const result = ensureConstructCredentials({ force: true, autoLink: true });
const notice = formatCredentialBootstrapNotice(result);
if (notice) console.log(notice);
else console.log(`Credentials ready (${getUserEnvPath()})`);
