/**
 * lib/providers/credential-warmup.mjs — resolve configured provider secrets once at startup.
 *
 * Materializes op:// references through the 1Password CLI before the first model
 * call so chat and artifact loops fail fast with actionable errors instead of
 * sending literal op:// strings or surfacing confusing provider 404s.
 */

import { API_KEY_CREDENTIALS, primaryEnvVar } from './credential-catalog.mjs';
import {
  extractOpRef,
  hasAnySecret,
  resolveFirstSecret,
  SecretResolutionError,
} from './secret-resolver.mjs';
import { providerGroupForModel } from '../models/execution-capability-profile.mjs';

const PROVIDER_CREDENTIAL_VARS = Object.freeze({
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY'],
  local: ['LOCAL_LLM_API_KEY', 'LOCAL_LLM_BASE_URL'],
});

export function credentialVarsForProvider(providerId) {
  return PROVIDER_CREDENTIAL_VARS[providerId] || [];
}

export function credentialVarsForModel(modelId) {
  if (!modelId || typeof modelId !== 'string') return [];
  const provider = providerGroupForModel(modelId);
  return credentialVarsForProvider(provider);
}

export function warmConfiguredCredentials({ env = process.env, cwd = process.cwd(), opRead } = {}) {
  const warmed = [];
  const failures = [];

  for (const entry of API_KEY_CREDENTIALS) {
    if (!hasAnySecret(entry.envVars, { env, cwd })) continue;
    const varName = primaryEnvVar(entry);
    try {
      const resolved = resolveFirstSecret(entry.envVars, { env, cwd, opRead });
      if (!resolved) continue;
      warmed.push(varName);
      for (const name of entry.envVars) {
        const raw = env[name];
        if (raw && extractOpRef(raw)) env[name] = resolved;
      }
    } catch (err) {
      failures.push({
        id: entry.id,
        varName,
        message: err instanceof SecretResolutionError ? err.message : String(err?.message || err),
        code: err instanceof SecretResolutionError ? err.code : 'CREDENTIAL_WARM_FAILED',
      });
    }
  }

  return { warmed, failures };
}

export function formatCredentialWarmupErrors(failures = [], { envPath } = {}) {
  if (!failures.length) return [];
  const lines = failures.map((f) => `${f.varName}: ${f.message}`);
  lines.push(
    'Unlock 1Password, run `op signin`, and confirm op:// references in '
    + `${envPath || '~/.config/construct/config.env'} resolve with \`op read <ref>\`.`,
  );
  return lines;
}

export function blockingWarmupFailures(failures = [], { modelId } = {}) {
  const needed = new Set(credentialVarsForModel(modelId));
  if (!needed.size) return failures;
  return failures.filter((f) => needed.has(f.varName));
}
