/**
 * dashboard/src/pages/Models.tsx — LLM model tier configuration.
 *
 * Per-tier (reasoning/standard/fast) primary + fallback selection backed by
 * the provider catalog returned from `/api/models/providers`. Pricing is
 * resolved on-demand from `/api/models/pricing` (OpenRouter live catalog +
 * static built-ins; local/Ollama models are tagged free).
 *
 * Provider credentials live exclusively on the Providers page. This page
 * surfaces tier selection only — never another credential editor.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  fetchRegistry,
  fetchModelsProviders,
  fetchModelsPricing,
  saveModelTier,
  applyFreeModels,
} from '../lib/api';
import SmallScreenNotice from '../components/SmallScreenNotice';

type Tier = 'reasoning' | 'standard' | 'fast';
const TIERS: Tier[] = ['reasoning', 'standard', 'fast'];

type TierState = { primary: string; fallback: string[] };

type Provider = {
  id: string;
  label: string;
  tiers: Record<Tier, string>;
  options: Record<Tier, string[]>;
  local?: boolean;
  requiresEnv?: string[];
  pricingHint?: string | null;
};

type Catalog = {
  providers: Provider[];
  tierOptions: Record<Tier, string[]>;
};

type PricingEntry = {
  input: number;
  output: number;
  unit?: string;
  currency?: string;
  source?: string;
  label?: string;
};

function formatPricingForOption(entry: PricingEntry | null | undefined): string {
  if (!entry) return '';
  if (entry.source === 'local') return entry.label || 'free · runs locally';
  if (entry.input === 0 && entry.output === 0) return 'free';
  if (!Number.isFinite(entry.input) || !Number.isFinite(entry.output)) return '';
  return `$${entry.input.toFixed(2)} in · $${entry.output.toFixed(2)} out /1M`;
}

export default function Models() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [models, setModels] = useState<Record<Tier, TierState>>({ reasoning: { primary: '', fallback: [] }, standard: { primary: '', fallback: [] }, fast: { primary: '', fallback: [] } });
  const [original, setOriginal] = useState<Record<Tier, TierState> | null>(null);
  const [pricing, setPricing] = useState<Record<string, PricingEntry | null>>({});
  const [pricingLoading, setPricingLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Tier | null>(null);
  const [applyingFree, setApplyingFree] = useState(false);
  const [applyResult, setApplyResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAllModels, setShowAllModels] = useState(false);

  useEffect(() => {
    Promise.all([
      fetchRegistry().then(d => d.models ?? {}).catch(() => ({})),
      fetchModelsProviders().catch(() => null),
    ]).then(([m, cat]) => {
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
    }).finally(() => setLoading(false));
  }, []);

  // Pricing fetch — pulls live numbers for every id rendered in any selector.
  // Locked behind catalog presence so we don't spam the API while loading.
  useEffect(() => {
    if (!catalog) return;
    const ids = new Set<string>();
    for (const t of TIERS) {
      for (const id of catalog.tierOptions?.[t] ?? []) ids.add(id);
    }
    for (const t of TIERS) {
      if (models[t].primary) ids.add(models[t].primary);
      for (const f of models[t].fallback) if (f) ids.add(f);
    }
    const list = Array.from(ids);
    if (list.length === 0) return;
    setPricingLoading(true);
    fetchModelsPricing(list)
      .then((d) => setPricing(d.pricing ?? {}))
      .catch(() => {})
      .finally(() => setPricingLoading(false));
  }, [catalog, models]);

  // Only models from configured providers by default. Expand to all with toggle.
  const configuredProviders = useMemo(() => catalog?.providers?.filter(p => p.configured) ?? [], [catalog]);
  const allOptionsFor = (t: Tier): string[] => catalog?.tierOptions?.[t] ?? [];
  const configuredOptionsFor = (t: Tier): string[] => {
    const configured = configuredProviders.flatMap(p => p.options[t] || []);
    return [...new Set(configured)];
  };
  const dirty = useMemo<Record<Tier, boolean>>(() => {
    const d: Record<Tier, boolean> = { reasoning: false, standard: false, fast: false };
    if (!original) return d;
    for (const t of TIERS) {
      d[t] = JSON.stringify(models[t]) !== JSON.stringify(original[t]);
    }
    return d;
  }, [models, original]);

  const optionsFor = (t: Tier): string[] => showAllModels ? allOptionsFor(t) : configuredOptionsFor(t);

  const renderOption = (id: string) => {
    const price = pricing[id];
    const priceLabel = formatPricingForOption(price);
    return priceLabel ? `${id}  —  ${priceLabel}` : id;
  };

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

  const applyFree = async () => {
    setApplyingFree(true);
    setError(null);
    setApplyResult(null);
    try {
      const res = await applyFreeModels();
      const sel = res.selections || {};
      const updated: Record<Tier, TierState> = { ...models };
      for (const t of TIERS) {
        if (sel[t]) updated[t] = { primary: sel[t], fallback: models[t].fallback };
      }
      setModels(updated);
      setOriginal(JSON.parse(JSON.stringify(updated)));
      const picked = TIERS.filter((t) => sel[t]).map((t) => `${t}: ${sel[t]}`).join(' · ');
      setApplyResult(picked ? `Saved ${picked}` : 'Polled OpenRouter but no free models met the per-tier context thresholds.');
    } catch (e: any) {
      setError(e.message || 'Auto-pick failed. Set OPENROUTER_API_KEY in Providers, then retry.');
    } finally {
      setApplyingFree(false);
    }
  };

  const noPrimarySet = TIERS.every((t) => !models[t].primary);

  if (loading) return <div className="text-center py-20 text-gray-600">Loading...</div>;

  const btnPrimary = 'px-2.5 py-1 text-xs font-medium rounded border border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50';
  const btnGhost = 'px-2.5 py-1 text-xs font-medium rounded border border-gray-300 bg-white text-gray-800 hover:bg-gray-100 transition-colors disabled:opacity-50';

  const localProviders = (catalog?.providers ?? []).filter((p) => p.local);

  return (
    <div>
      <SmallScreenNotice />
      <h1 className="text-xl font-bold mb-1">Model Tiers</h1>
      <p className="text-xs text-gray-600 mb-3">
        Construct ships with no model selected — pick one per tier before running any LLM-backed
        workflow. Pricing is per million tokens (USD). Live OpenRouter numbers refresh every 5
        minutes; Anthropic and OpenAI direct endpoints use the published list price.
        {pricingLoading && <span className="ml-2 text-indigo-600">refreshing…</span>}
      </p>

      {noPrimarySet && (
        <div className="mb-3 px-3 py-2 rounded bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold">No models selected.</p>
            <p>Pick a primary for each tier below, or use auto-pick to seed all three tiers from the OpenRouter free catalog.</p>
          </div>
          <button onClick={applyFree} disabled={applyingFree} className="px-2.5 py-1 text-xs font-medium rounded border border-amber-600 bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-50 whitespace-nowrap">
            {applyingFree ? 'Polling…' : 'Auto-pick free models'}
          </button>
        </div>
      )}

      {!noPrimarySet && (
        <div className="mb-3 flex items-center gap-3 text-xs">
          <button onClick={applyFree} disabled={applyingFree} className="px-2.5 py-1 font-medium rounded border border-gray-300 bg-white text-gray-800 hover:bg-gray-100 transition-colors disabled:opacity-50">
            {applyingFree ? 'Polling…' : 'Re-pick free OpenRouter models'}
          </button>
          <span className="text-gray-600">Replaces each tier's primary with the best free OpenRouter model meeting the context threshold (32k reasoning, 16k standard, 8k fast).</span>
        </div>
      )}

      {applyResult && (
        <div className="mb-3 px-3 py-2 rounded bg-green-50 border border-green-200 text-green-800 text-xs">{applyResult}</div>
      )}

      {/* Configured providers summary */}
      {configuredProviders.length > 0 && (
        <div className="mb-3 px-3 py-2 rounded bg-green-50 border border-green-200 text-xs">
          <p className="font-semibold text-green-900 mb-1">Your configured providers ({configuredProviders.length})</p>
          <ul className="text-green-800 space-y-0.5 flex flex-wrap gap-x-4 gap-y-0.5">
            {configuredProviders.map((p) => (
              <li key={p.id} className="inline-flex items-center gap-1">
                <span className="text-green-700">✓</span>
                <span className="font-mono">{p.id}</span>
                <span className="text-green-700">— {p.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {configuredProviders.length === 0 && catalog?.providers?.length > 0 && (
        <div className="mb-3 px-3 py-2 rounded bg-amber-50 border border-amber-200 text-xs">
          <p className="font-semibold text-amber-900 mb-1">No providers configured</p>
          <p className="text-amber-800">Add API keys on the <a href="#/providers" className="underline">Providers</a> page, then models from those providers will appear here.</p>
        </div>
      )}

      {/* Toggle to show all models (including unconfigured providers) */}
      {catalog && (
        <label className="flex items-center gap-2 mb-3 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={showAllModels} onChange={e => setShowAllModels(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-gray-300" />
          Show all models (including unconfigured providers)
        </label>
      )}

      {localProviders.length > 0 && (
        <div className="mb-3 px-3 py-2 rounded bg-indigo-50 border border-indigo-200 text-xs">
          <p className="font-semibold text-indigo-900 mb-1">Local providers available</p>
          <ul className="text-indigo-900 space-y-0.5">
            {localProviders.map((p) => (
              <li key={p.id}>
                <span className="font-mono">{p.id}</span> — {p.label}
                {p.requiresEnv?.length ? <> · needs <code className="px-1 bg-white rounded">{p.requiresEnv.join(', ')}</code></> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <div className="mb-3 px-3 py-2 rounded bg-red-50 border border-red-200 text-red-800 text-xs">{error}</div>}

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {TIERS.map((t, idx) => {
          const providers = showAllModels ? catalog?.providers ?? [] : configuredProviders;
          const m = models[t];
          const primaryPrice = pricing[m.primary];
          const primaryLabel = formatPricingForOption(primaryPrice);

          // Build optgroups: for each provider, list its models for this tier
          const optgroups = providers
            .filter(p => (p.options[t] ?? []).length > 0)
            .map(p => ({
              label: p.label,
              configured: p.configured,
              models: p.options[t] ?? [],
            }));

          const renderGroupedOptions = (selected: string) => (
            <>
              <option value="">— select model —</option>
              {optgroups.map(g => (
                <optgroup key={g.label} label={`${g.configured ? '' : '○ '}${g.label}`}>
                  {g.models.map(mId => (
                    <option key={mId} value={mId}>{renderOption(mId)}</option>
                  ))}
                </optgroup>
              ))}
              {selected && !optionsFor(t).includes(selected) && (
                <option value={selected}>{renderOption(selected)} (current)</option>
              )}
            </>
          );

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
                <div>
                  <select value={m.primary} onChange={e => setPrimary(t, e.target.value)}
                    className="w-full px-2 py-1 text-xs border border-gray-300 rounded bg-white">
                    {renderGroupedOptions(m.primary)}
                  </select>
                  {primaryLabel && m.primary && (
                    <p className="text-[10px] text-gray-600 mt-0.5 font-mono">{primaryLabel}</p>
                  )}
                </div>
                <label className="text-xs font-medium text-gray-700 self-start pt-1">Fallback</label>
                <div>
                  {m.fallback.length === 0 && <p className="text-xs text-gray-600 mb-1">none</p>}
                  {m.fallback.map((fb, i) => (
                    <div key={i} className="flex gap-1 mb-1">
                      <select value={fb} onChange={e => setFallbackAt(t, i, e.target.value)}
                        className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded bg-white">
                        {renderGroupedOptions(fb)}
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

      <p className="mt-4 text-xs text-gray-600">
        Need to add or rotate an API key? Manage credentials on the{' '}
        <a href="#/providers" className="underline hover:no-underline text-indigo-700">Providers</a> page —
        the single edit surface for every provider env var.
      </p>
    </div>
  );
}
