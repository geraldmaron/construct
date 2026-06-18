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

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
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
