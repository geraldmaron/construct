/**
 * Providers.tsx — model provider config surface.
 *
 * Lists every model provider Construct knows about (Anthropic, OpenAI,
 * OpenRouter, Ollama, Groq, Mistral, Gemini) with connection state
 * driven by the env-var pointer. Each row shows the connection pip,
 * the env var that gates it, and a docs link to obtain a key.
 *
 * Single source of truth: reads from /api/insights → providers — same
 * data backing the Mission Control providers row, no drift.
 */
import { useEffect, useState } from 'react';
import { fetchInsights } from '../lib/api';

type Provider = {
  id: string;
  displayName: string;
  envKey: string;
  docsUrl: string;
  configured: boolean;
  state: 'configured' | 'not-configured';
};

function pip(state: string) {
  return state === 'configured' ? 'pip pip-healthy' : 'pip pip-down';
}

export default function Providers() {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchInsights()
      .then((data: any) => setProviders(data.providers || []))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="max-w-5xl space-y-6">
      <header>
        <p className="text-text-dim text-xs uppercase tracking-wider mb-1">Page</p>
        <h1 className="text-3xl font-semibold tracking-tight">Model providers</h1>
        <p className="text-text-muted text-sm mt-2">
          Connection state for every provider Construct can route to. API keys live in <code className="px-1 py-0.5 bg-bg-muted rounded">.env</code> or <code className="px-1 py-0.5 bg-bg-muted rounded">~/.construct/config.env</code> — never in the JSON config. Set the env var, then restart <code className="px-1 py-0.5 bg-bg-muted rounded">construct up</code>.
        </p>
      </header>

      {error && (
        <div className="card" style={{ borderColor: 'var(--status-down)' }}>
          <p className="text-sm">{error}</p>
        </div>
      )}

      {!providers && !error && (
        <p className="text-sm text-text-dim">Loading providers…</p>
      )}

      {providers && providers.length > 0 && (
        <section className="card">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-text-dim">
              <tr>
                <th className="text-left font-normal pb-3 pr-4">Provider</th>
                <th className="text-left font-normal pb-3 pr-4">Status</th>
                <th className="text-left font-normal pb-3 pr-4">Env var</th>
                <th className="text-right font-normal pb-3"></th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="py-3 pr-4">
                    <div className="font-medium">{p.displayName}</div>
                    <div className="text-xs text-text-dim font-mono">{p.id}</div>
                  </td>
                  <td className="py-3 pr-4">
                    <span className={pip(p.state)}>
                      <span aria-hidden="true">{p.configured ? '✓' : '✕'}</span>
                      {p.configured ? 'configured' : 'not configured'}
                    </span>
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs">{p.envKey}</td>
                  <td className="py-3 text-right">
                    <a
                      href={p.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="btn text-xs"
                    >
                      Get key ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card">
        <h2 className="text-sm uppercase tracking-wider text-text-dim mb-3">How to add a provider</h2>
        <ol className="text-sm space-y-2 text-text-muted list-decimal list-inside">
          <li>Click <strong>Get key</strong> on the row for the provider you want.</li>
          <li>Paste the key into <code className="px-1 py-0.5 bg-bg-muted rounded">.env</code> or <code className="px-1 py-0.5 bg-bg-muted rounded">~/.construct/config.env</code> as the named env var.</li>
          <li>Restart with <code className="px-1 py-0.5 bg-bg-muted rounded">construct down && construct up</code>.</li>
          <li>Pick the model for each tier in the <a href="#/models" className="underline hover:text-text">Models</a> page or via <code className="px-1 py-0.5 bg-bg-muted rounded">construct config set models.reasoning &lt;provider/model&gt;</code>.</li>
        </ol>
        <p className="text-xs text-text-dim mt-3">
          Local models (Ollama) need only the base URL — no API key. Free OpenRouter models bill at $0 and are confirmed by <code className="px-1 py-0.5 bg-bg-muted rounded">construct pricing check</code>.
        </p>
      </section>
    </div>
  );
}
