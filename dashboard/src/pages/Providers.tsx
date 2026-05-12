/**
 * dashboard/src/pages/Providers.tsx — integration provider configuration.
 *
 * Compact table view: built-ins (read-only) and operator overrides
 * (`~/.construct/providers.json`) on equal footing. Plugin overrides support
 * add/edit/delete via `POST /api/providers/registry`. Three-state status:
 * healthy / not_configured / unhealthy — missing creds are gray, not red,
 * and never count as a degradation.
 *
 * Credentials editor lives below the table (shared `CredentialsCard`,
 * integration kind). All write paths persist via admin-gated POST endpoints.
 */

import { useEffect, useState } from 'react';
import {
  fetchProviders,
  fetchProviderCredentials,
  fetchProviderConfigPath,
  saveProviderOverride,
  deleteProviderOverride,
  fetchProviderSubscriptions,
} from '../lib/api';
import CredentialsCard, { CredentialGroup } from '../components/CredentialsCard';
import SubscriptionsCard, { Subscription, ProviderRef } from '../components/SubscriptionsCard';

type Health = { ok: boolean; detail?: string } | null;
type Status = 'healthy' | 'not_configured' | 'unhealthy' | 'unknown';
type ProviderRow = {
  id: string;
  displayName: string;
  description: string | null;
  capabilities: string[];
  source: string;
  health: Health;
  status: Status;
  configSchema: any;
};

const btnPrimary = 'px-2.5 py-1 text-xs font-medium rounded border border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50';
const btnGhost = 'px-2.5 py-1 text-xs font-medium rounded border border-gray-300 bg-white text-gray-800 hover:bg-gray-100 transition-colors disabled:opacity-50';
const btnDanger = 'px-2 py-0.5 text-xs font-medium rounded border border-red-300 bg-white text-red-700 hover:bg-red-50 transition-colors disabled:opacity-50';
const btnEdit = 'px-2 py-0.5 text-xs font-medium rounded border border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-50 transition-colors disabled:opacity-50';

export default function Providers() {
  const [summary, setSummary] = useState<ProviderRow[]>([]);
  const [errors, setErrors] = useState<Array<{ id: string; source: string; error: string }>>([]);
  const [creds, setCreds] = useState<CredentialGroup[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [paths, setPaths] = useState<{ envPath: string; overridesPath: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formId, setFormId] = useState('');
  const [formPkg, setFormPkg] = useState('');
  const [formOptions, setFormOptions] = useState('{}');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (probe = false) => {
    const res = await fetchProviders(probe).catch(() => ({ summary: [], errors: [] }));
    setSummary(res.summary ?? []);
    setErrors(res.errors ?? []);
  };
  const reloadCreds = () => fetchProviderCredentials().then(d => setCreds(d.credentials ?? [])).catch(() => {});
  const reloadSubs = () => fetchProviderSubscriptions().then(d => setSubs(d.subscriptions ?? [])).catch(() => {});

  useEffect(() => {
    Promise.all([refresh(true), reloadCreds(), reloadSubs(), fetchProviderConfigPath().then(setPaths).catch(() => {})])
      .finally(() => setLoading(false));
  }, []);

  const probeAll = async () => {
    setProbing(true);
    try { const r = await fetchProviders(true); setSummary(r.summary ?? []); setErrors(r.errors ?? []); }
    catch { /* ignore */ }
    finally { setProbing(false); }
  };

  const startAdd = () => {
    setEditingId(null); setFormId(''); setFormPkg(''); setFormOptions('{}');
    setShowForm(true); setError(null);
  };
  const startEdit = (row: ProviderRow) => {
    setEditingId(row.id); setFormId(row.id);
    setFormPkg(row.source.startsWith('plugin:') ? row.source.slice('plugin:'.length) : '');
    setFormOptions('{}');
    setShowForm(true); setError(null);
  };
  const closeForm = () => { setShowForm(false); setEditingId(null); setError(null); };

  const submit = async () => {
    setError(null);
    if (!formId || !formPkg) { setError('id and package required'); return; }
    let options: Record<string, unknown> = {};
    try { options = formOptions.trim() ? JSON.parse(formOptions) : {}; }
    catch { setError('options must be valid JSON'); return; }
    setSubmitting(true);
    try {
      await saveProviderOverride({ id: formId, package: formPkg, options });
      closeForm();
      await refresh(true);
    } catch (e: any) {
      setError(e.message || 'save failed');
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm(`Remove override '${id}'?`)) return;
    try { await deleteProviderOverride(id); await refresh(true); }
    catch (e: any) { setError(e.message || 'delete failed'); }
  };

  if (loading) return <div className="text-center py-20 text-gray-600">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Providers</h1>
        <div className="flex items-center gap-2">
          <button onClick={probeAll} disabled={probing} className={btnGhost}>
            {probing ? 'Probing…' : 'Probe health'}
          </button>
          <button onClick={startAdd} className={btnPrimary}>+ Add provider</button>
        </div>
      </div>

      {error && <div className="mb-3 px-3 py-2 rounded bg-red-50 border border-red-200 text-red-800 text-xs">{error}</div>}
      {errors.length > 0 && (
        <div className="mb-3 px-3 py-2 rounded bg-yellow-50 border border-yellow-200 text-yellow-900 text-xs">
          <p className="font-semibold mb-0.5">Some providers failed to load:</p>
          <ul className="list-disc list-inside space-y-0.5">
            {errors.map((e, i) => <li key={i}><span className="font-mono">{e.id}</span> ({e.source}): {e.error}</li>)}
          </ul>
        </div>
      )}

      {showForm && (
        <div className="mb-4 bg-white border border-indigo-200 rounded-lg p-3">
          <p className="text-xs font-semibold text-gray-800 mb-2">{editingId ? `Edit override: ${editingId}` : 'Add plugin override'}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-0.5">id</label>
              <input value={formId} onChange={e => setFormId(e.target.value)} placeholder="my-provider" disabled={Boolean(editingId)}
                className="w-full px-2 py-1 text-xs border border-gray-300 rounded font-mono disabled:bg-gray-100 disabled:text-gray-700" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-0.5">package</label>
              <input value={formPkg} onChange={e => setFormPkg(e.target.value)} placeholder="@scope/pkg or ./local/path"
                className="w-full px-2 py-1 text-xs border border-gray-300 rounded font-mono" />
            </div>
          </div>
          <label className="block text-xs font-medium text-gray-700 mb-0.5">options (JSON)</label>
          <textarea value={formOptions} onChange={e => setFormOptions(e.target.value)} rows={3}
            className="w-full px-2 py-1 text-xs font-mono border border-gray-300 rounded mb-2" />
          <div className="flex gap-1.5">
            <button onClick={submit} disabled={submitting} className={btnPrimary}>
              {submitting ? 'Saving…' : editingId ? 'Save changes' : 'Save override'}
            </button>
            <button onClick={closeForm} disabled={submitting} className={btnGhost}>Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr className="text-xs uppercase tracking-wide text-gray-700">
              <th className="text-left px-3 py-1.5 font-semibold">Provider</th>
              <th className="text-left px-3 py-1.5 font-semibold">Capabilities</th>
              <th className="text-left px-3 py-1.5 font-semibold">Source</th>
              <th className="text-left px-3 py-1.5 font-semibold">Status</th>
              <th className="text-right px-3 py-1.5 font-semibold w-32">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {summary.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-gray-600">No providers loaded.</td></tr>
            ) : summary.map(p => {
              const isBuiltIn = p.source === 'built-in';
              return (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-gray-900">{p.displayName}</span>
                      <code className="text-xs text-gray-600 font-mono">{p.id}</code>
                    </div>
                    {p.description && <p className="text-xs text-gray-700 truncate max-w-md" title={p.description}>{p.description}</p>}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {p.capabilities.map(c => (
                        <span key={c} className="bg-gray-100 text-gray-700 text-xs px-1.5 py-0.5 rounded">{c}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-1.5">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${isBuiltIn ? 'bg-gray-100 text-gray-700' : 'bg-violet-100 text-violet-800'}`}>
                      {isBuiltIn ? 'Built-in' : p.source.replace(/^plugin:/, '')}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    <StatusCell status={p.status} health={p.health} />
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center justify-end gap-1.5">
                      {isBuiltIn ? (
                        <span className="text-xs text-gray-500">read-only</span>
                      ) : (
                        <>
                          <button onClick={() => startEdit(p)} className={btnEdit}>Edit</button>
                          <button onClick={() => remove(p.id)} className={btnDanger}>Delete</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <CredentialsCard credentials={creds} kind="integration" envPath={paths?.envPath ?? null} onChange={reloadCreds} />

      <SubscriptionsCard
        subscriptions={subs}
        providers={summary.map(p => ({ id: p.id, displayName: p.displayName, configSchema: p.configSchema }) as ProviderRef)}
        onChange={reloadSubs}
      />
    </div>
  );
}

function StatusCell({ status, health }: { status: Status; health: Health }) {
  if (status === 'unknown') {
    return <span className="text-xs text-gray-600">—</span>;
  }
  const dot = status === 'healthy' ? 'bg-green-500'
    : status === 'not_configured' ? 'bg-gray-400'
    : 'bg-red-500';
  const label = status === 'healthy' ? 'Healthy'
    : status === 'not_configured' ? 'Not configured'
    : 'Unhealthy';
  const labelClass = status === 'healthy' ? 'text-green-800'
    : status === 'not_configured' ? 'text-gray-700'
    : 'text-red-800';
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`}></span>
        <span className={`text-xs font-medium ${labelClass}`}>{label}</span>
      </div>
      {health?.detail && (
        <p className="text-xs text-gray-600 mt-0.5 truncate max-w-xs" title={health.detail}>{health.detail}</p>
      )}
    </div>
  );
}
