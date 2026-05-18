/**
 * Providers.tsx — model provider config surface and credentials editor.
 *
 * Single source of truth for setting provider API keys. Lists every model
 * provider Construct knows about (Anthropic, OpenAI, OpenRouter, Ollama,
 * Groq, Mistral, Gemini) with status pip, env var, "Get key ↗" docs link,
 * and inline credentials editor (`CredentialsCard`). Saving hot-reloads
 * `process.env` server-side — no restart required.
 *
 * Reads from /api/insights → providers (same data backing the Mission
 * Control providers row) plus /api/providers/credentials for editable
 * env-var rows.
 */
import { useEffect, useState } from 'react';
import {
  fetchInsights,
  fetchProviderCredentials,
  fetchProviderConfigPath,
  fetchCustomCredentials,
  saveCustomCredentialProvider,
  deleteCustomCredentialProvider,
  fetchOpStatus,
  fetchProviderBilling,
  setProviderBilling,
} from '../lib/api';
import CredentialsCard, { CredentialGroup } from '../components/CredentialsCard';

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

type CustomEntry = { provider: string; label: string; kind: 'llm' | 'integration'; envVars: string[] };

export default function Providers() {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [creds, setCreds] = useState<CredentialGroup[]>([]);
  const [custom, setCustom] = useState<CustomEntry[]>([]);
  const [opStatus, setOpStatus] = useState<{ available: boolean; signedIn: boolean; accounts?: Array<{ email: string | null }> } | null>(null);
  const [billing, setBilling] = useState<{ global: string; providers: Record<string, { billingMode: string }> }>({ global: 'metered', providers: {} });
  const [paths, setPaths] = useState<{ envPath: string; overridesPath: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customError, setCustomError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<CustomEntry>({ provider: '', label: '', kind: 'llm', envVars: [''] });
  const [saving, setSaving] = useState(false);

  const reloadCreds = () =>
    fetchProviderCredentials()
      .then((d) => setCreds(d.credentials ?? []))
      .catch(() => {});

  const reloadCustom = () =>
    fetchCustomCredentials()
      .then((d) => setCustom(d.providers ?? []))
      .catch(() => {});

  useEffect(() => {
    Promise.all([
      fetchInsights().then((data: any) => data.providers || []).catch((err) => { setError(err.message); return []; }),
      fetchProviderCredentials().then((d) => d.credentials ?? []).catch(() => []),
      fetchProviderConfigPath().catch(() => null),
      fetchCustomCredentials().then((d) => d.providers ?? []).catch(() => []),
      fetchOpStatus().catch(() => ({ available: false, signedIn: false, accounts: [] })),
      fetchProviderBilling().catch(() => ({ global: 'metered', providers: {} })),
    ]).then(([provs, c, p, cu, op, b]) => {
      setProviders(provs);
      setCreds(c);
      setPaths(p);
      setCustom(cu);
      setOpStatus(op);
      setBilling(b);
    });
  }, []);

  const updateBilling = async (providerId: string, mode: 'metered' | 'subscription' | 'mixed') => {
    try {
      const res = await setProviderBilling(providerId, mode);
      setBilling((b) => ({ ...b, providers: res.providers || {} }));
    } catch (e: any) {
      setError(e?.message || 'failed to save billing mode');
    }
  };

  const effectiveBilling = (providerId: string) => {
    return billing.providers?.[providerId]?.billingMode || billing.global || 'metered';
  };

  const submitCustom = async () => {
    setCustomError(null);
    setSaving(true);
    try {
      await saveCustomCredentialProvider({
        provider: draft.provider.trim().toLowerCase(),
        label: draft.label.trim(),
        kind: draft.kind,
        envVars: draft.envVars.map((v) => v.trim().toUpperCase()).filter(Boolean),
      });
      await Promise.all([reloadCustom(), reloadCreds()]);
      setFormOpen(false);
      setDraft({ provider: '', label: '', kind: 'llm', envVars: [''] });
    } catch (e: any) {
      setCustomError(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const removeCustom = async (id: string) => {
    if (!window.confirm(`Remove custom provider "${id}"? Existing env values are kept.`)) return;
    try {
      await deleteCustomCredentialProvider(id);
      await Promise.all([reloadCustom(), reloadCreds()]);
    } catch (e: any) {
      setCustomError(e?.message || 'Failed to delete');
    }
  };

  return (
    <div className="max-w-5xl space-y-6">
      <header>
        <p className="text-text-dim text-xs uppercase tracking-wider mb-1">Page</p>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Model providers</h1>
        <p className="text-text-muted text-sm mt-2">
          Connection state and credentials for every provider Construct can route to. Keys are
          stored in <code className="px-1 py-0.5 bg-bg-muted rounded">~/.construct/config.env</code> (mode 0600)
          and hot-reloaded into <code className="px-1 py-0.5 bg-bg-muted rounded">process.env</code> — no restart needed.
          Pick the model per tier on the <a href="#/models" className="underline hover:text-text">Models</a> page after the key lands.
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
        <section className="card overflow-x-auto">
          <p className="text-xs text-text-muted mb-3">
            <strong>Billing</strong> sets how each provider's spend is counted on Mission Control.
            <span className="font-mono"> subscription</span> = flat-rate plan (Claude Pro / GPT Plus / OpenRouter credits), excluded from "today's actual spend".
            <span className="font-mono"> metered</span> = pay-per-token, counted toward the daily cap.
            Global default: <code className="px-1 bg-bg-muted rounded font-mono">{billing.global}</code>.
          </p>
          <table className="w-full text-sm min-w-[560px]">
            <thead className="text-xs uppercase tracking-wider text-text-dim">
              <tr>
                <th className="text-left font-normal pb-3 pr-4">Provider</th>
                <th className="text-left font-normal pb-3 pr-4">Status</th>
                <th className="text-left font-normal pb-3 pr-4">Env var</th>
                <th className="text-left font-normal pb-3 pr-4">Billing</th>
                <th className="text-right font-normal pb-3"></th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="py-3 pr-4">
                    <div className="font-medium">{p.displayName}</div>
                    <div className="text-xs text-text-dim font-mono break-all">{p.id}</div>
                  </td>
                  <td className="py-3 pr-4">
                    <span className={pip(p.state)}>
                      <span aria-hidden="true">{p.configured ? '✓' : '✕'}</span>
                      {p.configured ? 'configured' : 'not configured'}
                    </span>
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs break-all">{p.envKey}</td>
                  <td className="py-3 pr-4">
                    <select
                      value={effectiveBilling(p.id)}
                      onChange={(e) => updateBilling(p.id, e.target.value as 'metered' | 'subscription' | 'mixed')}
                      className="px-2 py-1 text-xs border border-border rounded bg-bg"
                      aria-label={`Billing mode for ${p.displayName}`}
                    >
                      <option value="metered">metered</option>
                      <option value="subscription">subscription</option>
                      <option value="mixed">mixed</option>
                    </select>
                    {!billing.providers?.[p.id] && (
                      <p className="text-[10px] text-text-dim mt-0.5">inherits global</p>
                    )}
                  </td>
                  <td className="py-3 text-right">
                    <a
                      href={p.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="btn text-xs whitespace-nowrap"
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

      {opStatus?.available && opStatus.signedIn && opStatus.accounts && opStatus.accounts.length > 0 && (
        <div className="card border border-emerald-300 bg-emerald-50/40">
          <h2 className="text-xs uppercase tracking-wider text-text-dim mb-1">1Password CLI</h2>
          <p className="text-sm">
            Signed in as <code className="px-1 bg-bg-muted rounded">{opStatus.accounts[0].email}</code>.
            Each credential row below has a <strong>1Password…</strong> button — paste a reference
            like <code className="px-1 bg-bg-muted rounded font-mono">op://Development/Anthropic/credential</code> and Construct will
            resolve it on the host (via <code className="px-1 bg-bg-muted rounded">op read</code>) and store the value the same way
            a manual paste does.
          </p>
        </div>
      )}

      <CredentialsCard credentials={creds} kind="llm" envPath={paths?.envPath ?? null} onChange={reloadCreds} opAvailable={Boolean(opStatus?.available && opStatus?.signedIn)} />

      <section className="card">
        <header className="flex items-baseline justify-between mb-3 gap-2 flex-wrap">
          <h2 className="text-sm uppercase tracking-wider text-text-dim">Custom providers</h2>
          {!formOpen && (
            <button onClick={() => setFormOpen(true)} className="btn btn-primary text-xs">+ Define a custom provider</button>
          )}
        </header>
        <p className="text-xs text-text-muted mb-3">
          Need a provider Construct doesn't ship a card for (xAI, Cohere, your own gateway)?
          Declare its env var(s) here and it'll show up in the credentials editor above. Stored in
          <code className="px-1 bg-bg-muted rounded mx-1">~/.construct/custom-credentials.json</code>
          (mode 0600). Values still live in <code className="px-1 bg-bg-muted rounded">~/.construct/config.env</code>;
          this file is only the allowlist of names.
        </p>

        {customError && (
          <div className="mb-3 px-3 py-2 rounded bg-red-50 border border-red-200 text-red-800 text-xs">{customError}</div>
        )}

        {custom.length === 0 && !formOpen && (
          <p className="text-xs text-text-dim italic">No custom providers defined.</p>
        )}

        {custom.length > 0 && (
          <ul className="space-y-1 mb-3">
            {custom.map((c) => (
              <li key={c.provider} className="flex items-center justify-between gap-2 bg-bg-muted rounded px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium truncate">{c.label} <span className="text-text-dim text-xs font-mono">({c.provider})</span></div>
                  <div className="text-xs text-text-dim font-mono break-all">env: {c.envVars.join(', ')} · kind: {c.kind}</div>
                </div>
                <button onClick={() => removeCustom(c.provider)} className="text-xs text-red-700 hover:text-red-900 whitespace-nowrap">Remove</button>
              </li>
            ))}
          </ul>
        )}

        {formOpen && (
          <div className="border border-border rounded p-3 space-y-3 bg-bg-muted/30">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-text-dim block mb-1">Provider id</span>
                <input
                  type="text"
                  value={draft.provider}
                  onChange={(e) => setDraft({ ...draft, provider: e.target.value })}
                  placeholder="xai · cohere · my-gateway"
                  className="w-full px-2 py-1 text-sm font-mono border border-border rounded bg-bg"
                />
                <span className="text-[10px] text-text-dim block mt-0.5">lowercase letters, digits, hyphens</span>
              </label>
              <label className="block">
                <span className="text-xs text-text-dim block mb-1">Display label</span>
                <input
                  type="text"
                  value={draft.label}
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                  placeholder="xAI Grok · Cohere"
                  className="w-full px-2 py-1 text-sm border border-border rounded bg-bg"
                />
              </label>
              <label className="block">
                <span className="text-xs text-text-dim block mb-1">Kind</span>
                <select
                  value={draft.kind}
                  onChange={(e) => setDraft({ ...draft, kind: e.target.value as 'llm' | 'integration' })}
                  className="w-full px-2 py-1 text-sm border border-border rounded bg-bg"
                >
                  <option value="llm">LLM provider</option>
                  <option value="integration">Integration (issue tracker / chat / docs)</option>
                </select>
              </label>
            </div>

            <div>
              <span className="text-xs text-text-dim block mb-1">Env var name(s)</span>
              {draft.envVars.map((v, i) => (
                <div key={i} className="flex gap-2 mb-1">
                  <input
                    type="text"
                    value={v}
                    onChange={(e) => {
                      const next = [...draft.envVars];
                      next[i] = e.target.value;
                      setDraft({ ...draft, envVars: next });
                    }}
                    placeholder="XAI_API_KEY"
                    className="flex-1 px-2 py-1 text-sm font-mono border border-border rounded bg-bg"
                  />
                  <button
                    onClick={() => setDraft({ ...draft, envVars: draft.envVars.filter((_, j) => j !== i) })}
                    disabled={draft.envVars.length === 1}
                    className="text-xs text-red-700 hover:text-red-900 disabled:opacity-30"
                    aria-label="Remove this env var"
                  >×</button>
                </div>
              ))}
              <button
                onClick={() => setDraft({ ...draft, envVars: [...draft.envVars, ''] })}
                className="text-xs text-indigo-700 hover:text-indigo-900"
              >+ Add another env var</button>
              <p className="text-[10px] text-text-dim mt-1">Must match <code>/^[A-Z][A-Z0-9_]&#123;1,63&#125;$/</code> · reserved OS vars (PATH, HOME, …) rejected</p>
            </div>

            <div className="flex gap-2 justify-end pt-2 border-t border-border">
              <button onClick={() => { setFormOpen(false); setCustomError(null); }} className="btn text-xs">Cancel</button>
              <button onClick={submitCustom} disabled={saving} className="btn btn-primary text-xs disabled:opacity-50">
                {saving ? 'Saving…' : 'Save provider'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
