const BASE_URL = '/api';

async function apiGet(path: string) {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
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
export const fetchKnowledgeTrends = () => apiGet('/knowledge/trends');
export const fetchKnowledgeIndex = () => apiGet('/knowledge/index');
export const fetchKnowledgeAsk = async (question: string) => {
  const res = await fetch(`${BASE_URL}/knowledge/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  });
  if (!res.ok) throw new Error(`POST /knowledge/ask: ${res.status}`);
  return res.json();
};
export const fetchEmbedBoundary = () => apiGet('/embed/boundary');
export const registerEmbedBoundary = async (data: { parentInstance: string, parentUrl: string, childInstanceId?: string }) => {
  const res = await fetch(`${BASE_URL}/embed/boundary/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`POST /embed/boundary/register: ${res.status}`);
  return res.json();
};
export const fetchTerraformFiles = () => apiGet('/terraform/files');
export const fetchModelsProviders = () => apiGet('/models/providers');
export const fetchSessionUsage = () => apiGet('/session-usage');
