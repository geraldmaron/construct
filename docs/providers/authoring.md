<!--
docs/providers/authoring.md — Plugin author guide for Construct data-source providers.

Covers the factory signature, meta object, configSchema, the five optional methods,
error handling, and registration. Source of truth: lib/providers/contract.mjs.
-->

# Authoring a Provider Plugin

A Construct provider is an ES module that exports a `create` factory. The factory receives an options object and returns a provider instance. The contract is defined in `lib/providers/contract.mjs`.

## Factory signature

```js
/**
 * @param {object} options
 * @param {object} options.env - Environment variables (defaults to process.env)
 * @returns {ProviderInstance}
 */
export function create({ env = process.env } = {}) {
  return {
    meta: { ... },
    configSchema: { ... },
    health: async (config) => ({ ok, detail }),
    read:    async (config) => item,          // optional
    search:  async (config) => items[],       // optional
    watch:   async (config, callback) => fn,  // optional
    write:   async (config, payload) => result, // optional
    webhook: async (config, request) => ack,  // optional
  };
}

export default create;
```

Both `create` and `default` exports are accepted. If a module exports both, `create` wins.

## The `meta` object

Required fields:

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Stable machine identifier. Must match the `id` in `providers.json`. |
| `displayName` | `string` | Human-readable name shown in `construct provider list`. |
| `capabilities` | `string[]` | Non-empty subset of `['read', 'search', 'watch', 'write', 'webhook']`. |

Optional fields:

| Field | Type | Description |
|---|---|---|
| `description` | `string` | One-line description of what the provider connects to. |

Only declare capabilities you actually implement. The registry checks that every declared capability has a matching method and throws at load time if one is missing.

## `configSchema`

A JSON Schema draft 2020-12 object describing the per-call configuration shape. The registry does not enforce this schema automatically — it is surfaced to the agent so it knows what fields to pass.

Example:

```js
configSchema: {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    resourceId: { type: 'string', description: 'ID of the resource to fetch' },
    query:      { type: 'string', description: 'Keyword search query' },
    limit:      { type: 'integer', minimum: 1, maximum: 100, default: 25 },
  },
}
```

## Required method: `health`

```js
async health(config) {
  // config is not used by most built-ins; it is reserved for future use
  return { ok: true, detail: 'connected to https://api.example.com' };
  // or on failure:
  return { ok: false, detail: 'EXAMPLE_API_TOKEN not set' };
}
```

`health` is always required. It is called by `construct provider test <id>` and is not wrapped by the circuit breaker.

## Optional methods

### `read`

Fetch a single named resource.

```js
async read(config) {
  if (!config?.resourceId) throw new Error('myProvider.read: config.resourceId required');
  const data = await fetchFromApi(`/resources/${config.resourceId}`, env);
  return data;
}
```

### `search`

Query by keyword or structured expression.

```js
async search(config) {
  if (!config?.query) throw new Error('myProvider.search: config.query required');
  const data = await fetchFromApi(`/search?q=${encodeURIComponent(config.query)}`, env);
  return Array.isArray(data.items) ? data.items : [];
}
```

Return an array. Consumers that call `search` expect an iterable result.

### `watch`

Subscribe to a real-time event stream. Returns an unsubscribe function.

```js
async watch(config, callback) {
  const interval = setInterval(async () => {
    const events = await pollForEvents(config, env);
    events.forEach(callback);
  }, 5000);
  return () => clearInterval(interval);
}
```

### `write`

Create or update a resource.

```js
async write(config, payload) {
  const result = await postToApi('/resources', payload, env);
  return result;
}
```

### `webhook`

Verify and acknowledge an inbound webhook payload.

```js
async webhook(config, request) {
  const signature = request?.headers?.['x-example-signature'];
  if (!signature) return { ok: false, error: 'missing signature header' };
  const valid = verifySignature(signature, config.webhookSecret, request.body);
  if (!valid) return { ok: false, error: 'signature mismatch' };
  return { ok: true, event: request?.headers?.['x-example-event'] || 'unknown' };
}
```

## Error handling

Throw a descriptive `Error` on validation failures. Include the provider id and method name in the message so callers can trace the source:

```js
throw new Error('myProvider.read: config.resourceId required');
```

Do not swallow errors silently — the circuit breaker counts uncaught rejections to track failure rate. If an error is non-retryable (e.g. invalid credentials), throw with a clear message so the operator can act on it.

## Registration

### Global (all projects)

Add to `~/.construct/providers.json`:

```json
{
  "providers": [
    {
      "id": "my-provider",
      "package": "@my-org/construct-provider-example",
      "options": {}
    }
  ]
}
```

### Project-local

Add to `.cx/providers.json` in the project root:

```json
{
  "providers": [
    {
      "id": "my-provider",
      "package": "./providers/my-provider.mjs",
      "options": { "baseUrl": "https://internal.example.com" }
    }
  ]
}
```

The `options` object is passed as-is to your `create` factory.

## Validate

After registering, verify the contract:

```bash
construct provider test my-provider
construct plugin validate
```

`construct provider test` calls `health()` and prints the result. `construct plugin validate` loads all discovered plugin manifests and reports contract violations.

## Minimal example

```js
// providers/my-provider.mjs

export function create({ env = process.env } = {}) {
  const baseUrl = env.MY_API_BASE_URL || 'https://api.example.com';
  const token = env.MY_API_TOKEN || '';

  async function apiFetch(path) {
    if (!token) throw new Error('my-provider: MY_API_TOKEN not set');
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`my-provider ${res.status}: ${res.statusText}`);
    return res.json();
  }

  return {
    meta: {
      id: 'my-provider',
      displayName: 'My API',
      capabilities: ['read', 'search'],
      description: 'Connects to the internal example API.',
    },
    configSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        resourceId: { type: 'string' },
        query: { type: 'string' },
      },
    },
    async health() {
      if (!token) return { ok: false, detail: 'MY_API_TOKEN not set' };
      try {
        await apiFetch('/health');
        return { ok: true, detail: `connected to ${baseUrl}` };
      } catch (err) {
        return { ok: false, detail: err.message };
      }
    },
    async read(config) {
      if (!config?.resourceId) throw new Error('my-provider.read: config.resourceId required');
      return apiFetch(`/resources/${encodeURIComponent(config.resourceId)}`);
    },
    async search(config) {
      if (!config?.query) throw new Error('my-provider.search: config.query required');
      const data = await apiFetch(`/search?q=${encodeURIComponent(config.query)}`);
      return Array.isArray(data.items) ? data.items : [];
    },
  };
}

export default create;
```
