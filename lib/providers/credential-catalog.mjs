/**
 * lib/providers/credential-catalog.mjs — LLM API-key provider credential metadata.
 *
 * Single catalog for env var names, Construct creds-store keys, and 1Password item
 * matching used by the secret resolver and credential bootstrap.
 */

export const API_KEY_CREDENTIALS = [
  {
    id: 'anthropic',
    envVars: ['ANTHROPIC_API_KEY'],
    credsKey: 'anthropic',
    opTitles: ['anthropic', 'anthropic api key'],
    opField: 'credential',
  },
  {
    id: 'openai',
    envVars: ['OPENAI_API_KEY'],
    credsKey: 'openai',
    opTitles: ['openai', 'openai api key'],
    opField: 'credential',
  },
  {
    id: 'openrouter',
    envVars: ['OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY'],
    credsKey: 'openrouter',
    opTitles: ['openrouter', 'openrouter api key'],
    opField: 'credential',
    openCodeProvider: 'openrouter',
  },
  {
    id: 'github',
    envVars: ['GITHUB_TOKEN', 'GH_TOKEN'],
    credsKey: 'github',
    opTitles: ['github', 'github token', 'github personal access token'],
    opField: 'credential',
  },
];

export function credentialForEnvVar(varName) {
  return API_KEY_CREDENTIALS.find((entry) => entry.envVars.includes(varName)) || null;
}

export function primaryEnvVar(entry) {
  return entry?.envVars?.[0] || null;
}
