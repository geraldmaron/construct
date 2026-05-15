/**
 * dashboard/src/lib/api.ts — typed fetch wrappers for the Construct dashboard.
 *
 * `apiPost` reads the `cx_csrf` cookie set by the server on first GET and
 * mirrors it into the `x-construct-csrf` header (double-submit cookie).
 * Without this every POST is rejected with `csrf_token_missing_or_invalid`.
 */

const BASE_URL = '/api';

function getCsrfToken(): string | null {
  for (const part of document.cookie.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === 'cx_csrf') return rest.join('=');
  }
  return null;
}

async function apiGet(path: string) {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  return res.json();
}

async function apiPost(path: string, body: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const csrf = getCsrfToken();
  if (csrf) headers['x-construct-csrf'] = csrf;
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `POST ${path}: ${res.status}`);
  }
  return res.json();
}

export const fetchStatus = () => apiGet('/status');
export const fetchAuthStatus = () => apiGet('/auth/status');
export const fetchRegistry = () => apiGet('/registry');
export const fetchApprovals = () => apiGet('/approvals');
export const fetchSnapshots = () => apiGet('/snapshots');
export const fetchArtifacts = () => apiGet('/artifacts');
export const fetchConfig = () => apiGet('/config');
export const fetchEmbedStatus = () => apiGet('/embed/status');
export const fetchMode = () => apiGet('/mode');
export const fetchAlias = () => apiGet('/alias');
export const fetchInsights = () => apiGet('/insights');
export const fetchProjectConfig = () => apiGet('/project-config');
export const fetchOverrideList = (category: string) => apiGet(`/overrides/${category}`);
export const fetchOverrideContent = (category: string, name: string) =>
  apiGet(`/overrides/${category}/${name}`);
export const fetchOverrideBackups = (category: string, name: string) =>
  apiGet(`/overrides/${category}/${name}?action=backups`);
export const writeOverrideContent = (category: string, name: string, content: string) =>
  fetch(`/api/overrides/${category}/${name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  }).then(async (r) => {
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  });
export const restoreOverrideBackup = (category: string, name: string, backupFilename: string) =>
  fetch(`/api/overrides/${category}/${name}?action=restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backupFilename }),
  }).then(async (r) => {
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  });

export const writeProjectConfig = (config: any) =>
  fetch('/api/project-config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  }).then(async (r) => {
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  });
export const fetchKnowledgeTrends = () => apiGet('/knowledge/trends');
export const fetchKnowledgeIndex = () => apiGet('/knowledge/index');
export const fetchKnowledgeAsk = (question: string) => apiPost('/knowledge/ask', { question });
export const fetchEmbedBoundary = () => apiGet('/embed/boundary');
export const registerEmbedBoundary = (data: { parentInstance: string, parentUrl: string, childInstanceId?: string }) =>
  apiPost('/embed/boundary/register', data);
export const fetchTerraformFiles = () => apiGet('/terraform/files');
export const fetchModelsProviders = () => apiGet('/models/providers');
export const fetchSessionUsage = () => apiGet('/session-usage');

export const fetchProviders = (probe = false) => apiGet(`/providers${probe ? '?probe=1' : ''}`);
export const fetchProviderCredentials = () => apiGet('/providers/credentials');
export const fetchProviderConfigPath = () => apiGet('/providers/config-path');

export const saveModelTier = (tier: string, primary: string, fallback: string[]) =>
  apiPost('/registry/models', { tier, primary, fallback });

export const saveProviderOverride = (entry: { id: string; package: string; options?: Record<string, unknown> }) =>
  apiPost('/providers/registry', { action: 'save', ...entry });

export const deleteProviderOverride = (id: string) =>
  apiPost('/providers/registry', { action: 'delete', id });

export const setProviderCredential = (envVar: string, value: string) =>
  apiPost('/providers/credentials', { envVar, value });

export const fetchBeads = () => apiGet('/beads');

export const fetchProviderSubscriptions = () => apiGet('/providers/subscriptions');

export const saveProviderSubscription = (entry: { id: string; provider: string; name: string; config: Record<string, unknown> }) =>
  apiPost('/providers/subscriptions', { action: 'save', ...entry });

export const deleteProviderSubscription = (id: string) =>
  apiPost('/providers/subscriptions', { action: 'delete', id });
