#!/usr/bin/env node
/**
 * lib/bridges/copilot-proxy.mjs — Minimal GitHub Copilot to OpenAI-compatible bridge.
 *
 * Translates standard OpenAI /v1/chat/completions requests to the Copilot API
 * using the user's active `gh` CLI session.
 */
import http from 'node:http';
import { execSync } from 'node:child_process';

const PORT = parseInt(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || '5174', 10);

let cachedSession = null;

async function getCopilotToken() {
  if (cachedSession && cachedSession.expires_at > (Date.now() / 1000) + 60) {
    return cachedSession.token;
  }

  try {
    const ghToken = execSync('gh auth token', { encoding: 'utf8' }).trim();
    const res = await fetch('https://api.github.com/copilot_internal/v2/token', {
      headers: {
        'Authorization': `Bearer ${ghToken}`,
        'Accept': 'application/json',
      }
    });

    if (!res.ok) throw new Error(`Failed to get session token: ${res.statusText}`);
    
    cachedSession = await res.json();
    return cachedSession.token;
  } catch (err) {
    console.error('Error fetching Copilot token:', err.message);
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
        
        // Map common model names to Copilot equivalents if needed
        // For now, we pass them through or default to gpt-4o
        const model = payload.model?.includes('gpt-4o') ? 'gpt-4o' : 
                      payload.model?.includes('claude-3.5-sonnet') ? 'claude-3.5-sonnet' : 
                      'gpt-4o';

        const copilotRes = await fetch('https://api.githubcopilot.com/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Github-Api-Version': '2023-07-07',
            'Editor-Version': 'vscode/1.90.0', // Spoof VS Code for compatibility
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
