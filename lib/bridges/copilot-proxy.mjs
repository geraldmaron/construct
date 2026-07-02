#!/usr/bin/env node
/**
 * lib/bridges/copilot-proxy.mjs — Minimal GitHub Copilot to OpenAI-compatible bridge.
 *
 * Translates standard OpenAI /v1/chat/completions requests to the Copilot API
 * using the user's active `gh` CLI session.
 */
import http from 'node:http';
import { getCopilotToken as resolveCopilotSessionToken } from '../providers/copilot-auth.mjs';

const PORT = parseInt(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || '5174', 10);

// Token minting, caching, and refresh live in copilot-auth (the OAuth device
// flow). The bridge only proxies, so a missing or failed session token surfaces
// to the client as a 401 with the remediation coming from `construct creds login copilot`.

async function getCopilotToken() {
  try {
    return await resolveCopilotSessionToken();
  } catch (err) {
    console.error('Error obtaining Copilot token:', err.message);
    return null;
  }
}

// Fail closed: the bridge fronts the user's Copilot entitlement, so every request
// must carry the per-launch bearer token service-manager injects, and an unconfigured
// token means no access at all. No CORS headers are emitted — the only legitimate
// caller is a loopback server process (OpenCode), never a browser page, so a wildcard
// Access-Control-Allow-Origin would just let any open tab drive the entitlement.

const EXPECTED_TOKEN = process.env.CONSTRUCT_COPILOT_BRIDGE_TOKEN || null;

function isAuthorized(req) {
  if (!EXPECTED_TOKEN) return false;
  const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return Boolean(match) && match[1] === EXPECTED_TOKEN;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (!isAuthorized(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized: missing or invalid bridge bearer token.' }));
    return;
  }

  if (req.url === '/v1/chat/completions' && req.method === 'POST') {
    const token = await getCopilotToken();
    if (!token) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to authenticate with GitHub Copilot via gh CLI.' }));
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);

        // Pass the requested model through unchanged so the caller's selection is
        // honored; Copilot validates it against the account's available models and
        // returns a clear error for an unsupported id rather than silently swapping.
        const model = payload.model || 'gpt-4o';

        const copilotRes = await fetch('https://api.githubcopilot.com/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Github-Api-Version': '2023-07-07',
            'Copilot-Integration-Id': 'vscode-chat',
            'Editor-Version': 'vscode/1.90.0',
          },
          body: JSON.stringify({
            ...payload,
            model
          })
        });

        res.writeHead(copilotRes.status, {
          'Content-Type': copilotRes.headers.get('Content-Type'),
        });

        if (payload.stream) {
           const reader = copilotRes.body.getReader();
           while (true) {
             const { done, value } = await reader.read();
             if (done) break;
             res.write(value);
           }
           res.end();
        } else {
          const data = await copilotRes.text();
          res.end(data);
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Copilot Bridge listening on http://127.0.0.1:${PORT}`);
});
