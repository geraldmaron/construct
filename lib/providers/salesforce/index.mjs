/**
 * lib/providers/salesforce/index.mjs — Salesforce data-source provider.
 *
 * Capabilities: search, read.
 *
 * Auth: OAuth password flow via env:
 *   SALESFORCE_INSTANCE_URL  e.g. https://yourorg.my.salesforce.com
 *   SALESFORCE_ACCESS_TOKEN  bearer token (operator obtains via sfdx or OAuth flow)
 *
 * Config (per call):
 *   - soql:     SOQL query string
 *   - sobject:  object type (Account|Opportunity|Contact|Custom__c) for read
 *   - id:       record id for read
 *
 * The provider intentionally avoids embedding an OAuth flow itself —
 * operators are expected to supply an access token. A future enhancement
 * can land an interactive OAuth flow with refresh-token persistence.
 */

const API_VERSION = 'v60.0';

function authConfig(env) {
  const instanceUrl = (env.SALESFORCE_INSTANCE_URL || '').replace(/\/$/, '');
  const accessToken = env.SALESFORCE_ACCESS_TOKEN || '';
  return { instanceUrl, accessToken, ok: Boolean(instanceUrl && accessToken) };
}

async function sfFetch(path, env, init = {}) {
  const auth = authConfig(env);
  if (!auth.ok) throw new Error('salesforce: SALESFORCE_INSTANCE_URL and SALESFORCE_ACCESS_TOKEN required');
  const res = await fetch(`${auth.instanceUrl}${path}`, {
    ...init,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.accessToken}`,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Salesforce ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

export function create({ env = process.env } = {}) {
  return {
    meta: {
      id: 'salesforce',
      displayName: 'Salesforce',
      capabilities: ['read', 'search'],
      description: 'Accounts, opportunities, custom objects, SOQL.',
    },

    configSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        soql: { type: 'string' },
        sobject: { type: 'string' },
        id: { type: 'string', pattern: '^[a-zA-Z0-9]{15,18}$' },
      },
    },

    async health() {
      const auth = authConfig(env);
      if (!auth.ok) {
        return { ok: false, detail: 'SALESFORCE_INSTANCE_URL / SALESFORCE_ACCESS_TOKEN not set' };
      }
      try {
        await sfFetch(`/services/data/${API_VERSION}/`, env);
        return { ok: true, detail: `connected to ${auth.instanceUrl}` };
      } catch (err) {
        return { ok: false, detail: err.message };
      }
    },

    async read(config) {
      if (!config?.sobject || !config?.id) {
        throw new Error('salesforce.read: config.sobject and config.id required');
      }
      return sfFetch(
        `/services/data/${API_VERSION}/sobjects/${encodeURIComponent(config.sobject)}/${encodeURIComponent(config.id)}`,
        env
      );
    },

    async search(config) {
      if (!config?.soql) throw new Error('salesforce.search: config.soql required');
      const data = await sfFetch(
        `/services/data/${API_VERSION}/query?q=${encodeURIComponent(config.soql)}`,
        env
      );
      return Array.isArray(data?.records) ? data.records : [];
    },
  };
}

export default create;
