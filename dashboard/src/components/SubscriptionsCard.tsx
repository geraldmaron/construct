/**
 * dashboard/src/components/SubscriptionsCard.tsx — per-provider data
 * subscriptions ("which repos / channels / queries to fetch").
 *
 * Each row pairs a provider with a saved configSchema-validated config
 * object (e.g. github + {repo, kind}). Add/Edit opens a form generated
 * from the provider's configSchema so every provider gets the same
 * intuitive UX. Persists to `~/.construct/provider-subscriptions.json`
 * via `POST /api/providers/subscriptions`.
 */

import { useState } from 'react';
import { saveProviderSubscription, deleteProviderSubscription } from '../lib/api';

type SchemaProperty = {
  type?: string;
  enum?: string[];
  default?: unknown;
  description?: string;
  pattern?: string;
  minimum?: number;
  maximum?: number;
};
type ConfigSchema = {
  type?: string;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
};

export type Subscription = {
  id: string;
  provider: string;
  name: string;
  config: Record<string, unknown>;
};

export type ProviderRef = {
  id: string;
  displayName: string;
  configSchema: ConfigSchema | null;
};

type Props = {
  subscriptions: Subscription[];
  providers: ProviderRef[];
  onChange: () => void;
};

const btnPrimary = 'px-2.5 py-1 text-xs font-medium rounded border border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50';
const btnGhost = 'px-2.5 py-1 text-xs font-medium rounded border border-gray-300 bg-white text-gray-800 hover:bg-gray-100 transition-colors disabled:opacity-50';
const btnDanger = 'px-2 py-0.5 text-xs font-medium rounded border border-red-300 bg-white text-red-700 hover:bg-red-50 transition-colors disabled:opacity-50';
const btnEdit = 'px-2 py-0.5 text-xs font-medium rounded border border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-50 transition-colors disabled:opacity-50';

export default function SubscriptionsCard({ subscriptions, providers, onChange }: Props) {
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [adding, setAdding] = useState(false);

  const startAdd = () => { setAdding(true); setEditing(null); };
  const startEdit = (s: Subscription) => { setEditing(s); setAdding(false); };
  const close = () => { setEditing(null); setAdding(false); };

  const remove = async (id: string) => {
    if (!confirm(`Delete subscription '${id}'?`)) return;
    try { await deleteProviderSubscription(id); onChange(); }
    catch (e: any) { alert(e.message || 'delete failed'); }
  };

  return (
    <div className="mt-6 bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Subscriptions <span className="text-gray-600 font-normal normal-case">— repos, channels, queries to fetch</span></p>
        <button onClick={startAdd} className={btnPrimary}>+ Add subscription</button>
      </div>

      {(adding || editing) && (
        <div className="px-4 py-3 border-b border-gray-200 bg-indigo-50/50">
          <SubscriptionForm
            initial={editing}
            providers={providers}
            onCancel={close}
            onSaved={() => { close(); onChange(); }}
          />
        </div>
      )}

      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr className="text-xs uppercase tracking-wide text-gray-700">
            <th className="text-left px-3 py-1.5 font-semibold">Name</th>
            <th className="text-left px-3 py-1.5 font-semibold">Provider</th>
            <th className="text-left px-3 py-1.5 font-semibold">Config</th>
            <th className="text-right px-3 py-1.5 font-semibold w-32">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {subscriptions.length === 0 ? (
            <tr><td colSpan={4} className="px-3 py-6 text-center text-xs text-gray-600">
              No subscriptions yet. Click "+ Add subscription" to fetch from a provider (e.g. a GitHub repo or Slack channel).
            </td></tr>
          ) : subscriptions.map(s => {
            const p = providers.find(x => x.id === s.provider);
            return (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-3 py-1.5">
                  <div className="text-sm font-medium text-gray-900">{s.name}</div>
                  <code className="text-xs text-gray-600 font-mono">{s.id}</code>
                </td>
                <td className="px-3 py-1.5">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                    {p?.displayName || s.provider}
                  </span>
                </td>
                <td className="px-3 py-1.5">
                  <code className="text-xs font-mono text-gray-700 truncate block max-w-md" title={JSON.stringify(s.config)}>
                    {summarizeConfig(s.config)}
                  </code>
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex items-center justify-end gap-1.5">
                    <button onClick={() => startEdit(s)} className={btnEdit}>Edit</button>
                    <button onClick={() => remove(s.id)} className={btnDanger}>Delete</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function summarizeConfig(config: Record<string, unknown>): string {
  const entries = Object.entries(config).filter(([, v]) => v !== '' && v != null);
  if (entries.length === 0) return '(no config)';
  return entries.map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ');
}

function SubscriptionForm({ initial, providers, onCancel, onSaved }: {
  initial: Subscription | null;
  providers: ProviderRef[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [providerId, setProviderId] = useState(initial?.provider || providers[0]?.id || '');
  const [id, setId] = useState(initial?.id || '');
  const [name, setName] = useState(initial?.name || '');
  const [config, setConfig] = useState<Record<string, unknown>>(initial?.config || {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const provider = providers.find(p => p.id === providerId) || null;
  const schema = provider?.configSchema;

  const setField = (key: string, value: unknown) => setConfig(c => ({ ...c, [key]: value }));

  const submit = async () => {
    setError(null);
    if (!providerId) { setError('provider required'); return; }
    if (!id || !/^[\w.-]+$/.test(id)) { setError('id required (letters, digits, dot, dash, underscore)'); return; }
    if (!name) { setError('name required'); return; }
    setSaving(true);
    try {
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(config)) {
        if (v === '' || v == null) continue;
        cleaned[k] = v;
      }
      await saveProviderSubscription({ id, provider: providerId, name, config: cleaned });
      onSaved();
    } catch (e: any) {
      setError(e.message || 'save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <p className="text-xs font-semibold text-gray-800 mb-2">{initial ? `Edit subscription: ${initial.id}` : 'New subscription'}</p>
      {error && <p className="mb-2 text-xs text-red-700">{error}</p>}
      <div className="grid grid-cols-3 gap-2 mb-2">
        <Field label="Name">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Construct issues"
            className="w-full px-2 py-1 text-xs border border-gray-300 rounded" />
        </Field>
        <Field label="ID">
          <input value={id} onChange={e => setId(e.target.value)} placeholder="construct-issues" disabled={!!initial}
            className="w-full px-2 py-1 text-xs border border-gray-300 rounded font-mono disabled:bg-gray-100" />
        </Field>
        <Field label="Provider">
          <select value={providerId} onChange={e => { setProviderId(e.target.value); setConfig({}); }}
            disabled={!!initial}
            className="w-full px-2 py-1 text-xs border border-gray-300 rounded bg-white disabled:bg-gray-100">
            {providers.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
        </Field>
      </div>

      {schema?.properties && Object.entries(schema.properties).length > 0 && (
        <div className="border-t border-gray-200 pt-2 mt-2">
          <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">{provider?.displayName} config</p>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(schema.properties).map(([key, prop]) => (
              <SchemaField key={key} name={key} prop={prop} value={config[key]} onChange={v => setField(key, v)} />
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-1.5 mt-3">
        <button onClick={submit} disabled={saving} className={btnPrimary}>
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Add subscription'}
        </button>
        <button onClick={onCancel} disabled={saving} className={btnGhost}>Cancel</button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-0.5">{label}</label>
      {children}
    </div>
  );
}

function SchemaField({ name, prop, value, onChange }: {
  name: string;
  prop: SchemaProperty;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const desc = prop.description ? ` — ${prop.description}` : '';
  const labelText = `${name}${desc}`;
  const v = (value ?? prop.default ?? '') as string | number;

  if (prop.enum && prop.enum.length > 0) {
    return (
      <Field label={labelText}>
        <select value={v as string} onChange={e => onChange(e.target.value)}
          className="w-full px-2 py-1 text-xs border border-gray-300 rounded bg-white">
          <option value="">— none —</option>
          {prop.enum.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      </Field>
    );
  }

  if (prop.type === 'integer' || prop.type === 'number') {
    return (
      <Field label={labelText}>
        <input type="number" value={v as number} onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          min={prop.minimum} max={prop.maximum}
          className="w-full px-2 py-1 text-xs border border-gray-300 rounded font-mono" />
      </Field>
    );
  }

  return (
    <Field label={labelText}>
      <input type="text" value={v as string} onChange={e => onChange(e.target.value)}
        placeholder={prop.pattern ? `pattern: ${prop.pattern}` : ''}
        className="w-full px-2 py-1 text-xs border border-gray-300 rounded font-mono" />
    </Field>
  );
}
