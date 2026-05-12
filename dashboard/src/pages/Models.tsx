/**
 * dashboard/src/pages/Models.tsx — LLM model tier configuration.
 *
 * Per-tier (reasoning/standard/fast) primary + fallback selection backed by
 * the provider catalog returned from `/api/models/providers`. Save persists
 * to `agents/registry.json` via existing `POST /api/registry/models`.
 *
 * LLM credentials are editable inline via the shared `CredentialsCard`
 * (admin-gated POST `/api/providers/credentials`, file mode 0600,
 * audit-logged, hot-reloads `process.env`). The dashboard only ever
 * displays masked previews — full values never leave the server.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  fetchRegistry,
  fetchModelsProviders,
  fetchProviderCredentials,
  fetchProviderConfigPath,
  saveModelTier,
} from '../lib/api';
import CredentialsCard, { CredentialGroup } from '../components/CredentialsCard';

type Tier = 'reasoning' | 'standard' | 'fast';
const TIERS: Tier[] = ['reasoning', 'standard', 'fast'];

type TierState = { primary: string; fallback: string[] };

type Catalog = {
  providers: Array<{ id: string; label: string; tiers: Record<Tier, string>; options: Record<Tier, string[]> }>;
  tierOptions: Record<Tier, string[]>;
};

export default function Models() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [models, setModels] = useState<Record<Tier, TierState>>({ reasoning: { primary: '', fallback: [] }, standard: { primary: '', fallback: [] }, fast: { primary: '', fallback: [] } });
  const [original, setOriginal] = useState<Record<Tier, TierState> | null>(null);
  const [creds, setCreds] = useState<CredentialGroup[]>([]);
  const [paths, setPaths] = useState<{ envPath: string; overridesPath: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Tier | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reloadCreds = () => fetchProviderCredentials().then(d => setCreds(d.credentials ?? [])).catch(() => {});

  useEffect(() => {
    Promise.all([
      fetchRegistry().then(d => d.models ?? {}).catch(() => ({})),
      fetchModelsProviders().catch(() => null),
      fetchProviderCredentials().then(d => d.credentials ?? []).catch(() => []),
      fetchProviderConfigPath().catch(() => null),
    ]).then(([m, cat, c, p]) => {
      const next: Record<Tier, TierState> = { reasoning: { primary: '', fallback: [] }, standard: { primary: '', fallback: [] }, fast: { primary: '', fallback: [] } };
      for (const t of TIERS) {
        next[t] = {
          primary: m?.[t]?.primary ?? '',
          fallback: Array.isArray(m?.[t]?.fallback) ? m[t].fallback : [],
        };
      }
      setModels(next);
      setOriginal(JSON.parse(JSON.stringify(next)));
      setCatalog(cat);
      setCreds(c);
      setPaths(p);
    }).finally(() => setLoading(false));
  }, []);

  const dirty = useMemo<Record<Tier, boolean>>(() => {
    const d: Record<Tier, boolean> = { reasoning: false, standard: false, fast: false };
    if (!original) return d;
    for (const t of TIERS) {
      d[t] = JSON.stringify(models[t]) !== JSON.stringify(original[t]);
    }
    return d;
  }, [models, original]);

  const optionsFor = (t: Tier): string[] => catalog?.tierOptions?.[t] ?? [];

  const setPrimary = (t: Tier, v: string) => setModels(s => ({ ...s, [t]: { ...s[t], primary: v } }));
  const setFallbackAt = (t: Tier, i: number, v: string) => setModels(s => ({ ...s, [t]: { ...s[t], fallback: s[t].fallback.map((x, j) => j === i ? v : x) } }));
  const addFallback = (t: Tier) => setModels(s => ({ ...s, [t]: { ...s[t], fallback: [...s[t].fallback, ''] } }));
  const removeFallback = (t: Tier, i: number) => setModels(s => ({ ...s, [t]: { ...s[t], fallback: s[t].fallback.filter((_, j) => j !== i) } }));

  const save = async (t: Tier) => {
    if (!models[t].primary) { setError('Primary model required'); return; }
    setSaving(t);
    setError(null);
    try {
      const fb = models[t].fallback.filter(Boolean);
      await saveModelTier(t, models[t].primary, fb);
      setOriginal(o => o ? { ...o, [t]: { primary: models[t].primary, fallback: fb } } : o);
      setModels(s => ({ ...s, [t]: { primary: s[t].primary, fallback: fb } }));
    } catch (e: any) {
      setError(e.message || 'save failed');
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <div className="text-center py-20 text-gray-600">Loading...</div>;

  const btnPrimary = 'px-2.5 py-1 text-xs font-medium rounded border border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50';
  const btnGhost = 'px-2.5 py-1 text-xs font-medium rounded border border-gray-300 bg-white text-gray-800 hover:bg-gray-100 transition-colors disabled:opacity-50';

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Model Tiers</h1>
      {error && <div className="mb-3 px-3 py-2 rounded bg-red-50 border border-red-200 text-red-800 text-xs">{error}</div>}

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {TIERS.map((t, idx) => {
          const opts = optionsFor(t);
          const m = models[t];
          return (
            <div key={t} className={`px-3 py-2.5 ${idx > 0 ? 'border-t border-gray-200' : ''}`}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{t}</p>
                <button onClick={() => save(t)} disabled={!dirty[t] || saving === t}
                  className={dirty[t] ? btnPrimary : btnGhost}>
                  {saving === t ? 'Saving…' : dirty[t] ? 'Save' : 'Saved'}
                </button>
              </div>
              <div className="grid grid-cols-[80px_1fr] items-center gap-x-2 gap-y-1">
                <label className="text-xs font-medium text-gray-700">Primary</label>
                <select value={m.primary} onChange={e => setPrimary(t, e.target.value)}
                  className="w-full px-2 py-1 text-xs border border-gray-300 rounded bg-white">
                  <option value="">— select model —</option>
                  {opts.map(o => <option key={o} value={o}>{o}</option>)}
                  {m.primary && !opts.includes(m.primary) && <option value={m.primary}>{m.primary} (current)</option>}
                </select>
                <label className="text-xs font-medium text-gray-700 self-start pt-1">Fallback</label>
                <div>
                  {m.fallback.length === 0 && <p className="text-xs text-gray-600 mb-1">none</p>}
                  {m.fallback.map((fb, i) => (
                    <div key={i} className="flex gap-1 mb-1">
                      <select value={fb} onChange={e => setFallbackAt(t, i, e.target.value)}
                        className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded bg-white">
                        <option value="">— select model —</option>
                        {opts.map(o => <option key={o} value={o}>{o}</option>)}
                        {fb && !opts.includes(fb) && <option value={fb}>{fb} (current)</option>}
                      </select>
                      <button onClick={() => removeFallback(t, i)}
                        className="px-2 py-0.5 text-xs font-medium rounded border border-red-300 bg-white text-red-700 hover:bg-red-50 transition-colors">×</button>
                    </div>
                  ))}
                  <button onClick={() => addFallback(t)} className="text-xs font-medium text-indigo-700 hover:text-indigo-900 transition-colors">+ Add fallback</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <CredentialsCard credentials={creds} kind="llm" envPath={paths?.envPath ?? null} onChange={reloadCreds} />
    </div>
  );
}
