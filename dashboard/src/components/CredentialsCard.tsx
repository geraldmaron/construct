/**
 * dashboard/src/components/CredentialsCard.tsx — credential editor used by
 * Models (LLM kind) and Providers (integration kind).
 *
 * Compact table: one row per env var. Inline-editable, password-masked input.
 * Save/Clear/Cancel actions hit `POST /api/providers/credentials` (admin-gated,
 * file mode 0600, audit-logged, hot-reloads process.env). Stored values never
 * leave the server; only a masked preview is shown.
 */

import { Fragment, useState } from 'react';
import { setProviderCredential, pullCredentialFromOp } from '../lib/api';

export type CredentialVar = { envVar: string; set: boolean; preview: string | null };
export type CredentialGroup = {
  provider: string;
  label: string;
  kind: 'llm' | 'integration';
  vars: CredentialVar[];
  configured: 'none' | 'partial' | 'full';
};

type Props = {
  credentials: CredentialGroup[];
  kind: 'llm' | 'integration';
  envPath: string | null;
  onChange: () => void;
  opAvailable?: boolean;
};

const btnPrimary = 'px-2 py-0.5 text-xs font-medium rounded border border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50';
const btnGhost = 'px-2 py-0.5 text-xs font-medium rounded border border-gray-300 bg-white text-gray-800 hover:bg-gray-100 transition-colors disabled:opacity-50';
const btnDanger = 'px-2 py-0.5 text-xs font-medium rounded border border-red-300 bg-white text-red-700 hover:bg-red-50 transition-colors disabled:opacity-50';

export default function CredentialsCard({ credentials, kind, envPath, onChange, opAvailable = false }: Props) {
  const groups = credentials.filter(c => c.kind === kind);
  const copy = (text: string) => { try { navigator.clipboard.writeText(text); } catch { /* ignore */ } };

  return (
    <div className="mt-6 bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Credentials</p>
        <div className="flex items-center gap-3">
          {opAvailable && (
            <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5 font-medium">
              1Password CLI detected
            </span>
          )}
          {envPath && (
            <button onClick={() => copy(envPath)} className="text-xs font-medium text-indigo-700 hover:text-indigo-900 transition-colors">
              Copy config path
            </button>
          )}
        </div>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr className="text-xs uppercase tracking-wide text-gray-700">
            <th className="text-left px-3 py-1.5 font-semibold">Provider</th>
            <th className="text-left px-3 py-1.5 font-semibold">Env var</th>
            <th className="text-left px-3 py-1.5 font-semibold">Value</th>
            <th className="text-right px-3 py-1.5 font-semibold w-52">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {groups.flatMap(g => g.vars.map((v, i) => (
            <CredentialRow
              key={`${g.provider}-${v.envVar}`}
              provider={g.label}
              configured={g.configured}
              showProvider={i === 0}
              v={v}
              onChange={onChange}
              opAvailable={opAvailable}
            />
          )))}
        </tbody>
      </table>
    </div>
  );
}

function CredentialRow({ provider, configured, showProvider, v, onChange, opAvailable }: {
  provider: string;
  configured: 'none' | 'partial' | 'full';
  showProvider: boolean;
  v: CredentialVar;
  onChange: () => void;
  opAvailable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opOpen, setOpOpen] = useState(false);
  const [opRef, setOpRef] = useState('');
  const [opPulling, setOpPulling] = useState(false);

  const startEdit = () => { setEditing(true); setValue(''); setShow(false); setError(null); };
  const cancel = () => { setEditing(false); setValue(''); setError(null); };
  const startOp = () => { setOpOpen(true); setOpRef(''); setError(null); };
  const cancelOp = () => { setOpOpen(false); setOpRef(''); };
  const pullOp = async () => {
    if (!opRef.trim()) { setError("Enter a 1Password reference like 'op://Development/Anthropic/credential'"); return; }
    setOpPulling(true);
    setError(null);
    try {
      await pullCredentialFromOp(v.envVar, opRef.trim());
      setOpOpen(false);
      setOpRef('');
      onChange();
    } catch (e: any) {
      setError(e.message || 'pull from 1Password failed');
    } finally {
      setOpPulling(false);
    }
  };

  const save = async () => {
    if (!value) { setError('value required'); return; }
    setSaving(true);
    setError(null);
    try {
      await setProviderCredential(v.envVar, value);
      setEditing(false);
      setValue('');
      onChange();
    } catch (e: any) {
      setError(e.message || 'save failed');
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (!confirm(`Unset ${v.envVar}?`)) return;
    setSaving(true);
    setError(null);
    try {
      await setProviderCredential(v.envVar, '');
      onChange();
    } catch (e: any) {
      setError(e.message || 'unset failed');
    } finally {
      setSaving(false);
    }
  };

  const dot = configured === 'full' ? 'bg-green-500'
    : configured === 'partial' ? 'bg-yellow-500'
    : 'bg-gray-400';

  return (
    <Fragment>
      <tr className="hover:bg-gray-50">
        <td className="px-3 py-1.5">
          {showProvider && (
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${dot}`}></span>
              <span className="text-xs font-medium text-gray-800">{provider}</span>
            </div>
          )}
        </td>
        <td className="px-3 py-1.5">
          <code className="text-xs font-mono text-gray-800">{v.envVar}</code>
        </td>
        <td className="px-3 py-1.5">
          <code className={`text-xs font-mono ${v.set ? 'text-gray-700' : 'text-gray-500'}`}>{v.preview ?? 'not set'}</code>
        </td>
        <td className="px-3 py-1.5">
          {!editing && !opOpen && (
            <div className="flex items-center justify-end gap-1.5 flex-wrap">
              <button onClick={startEdit} disabled={saving} className={btnPrimary}>{v.set ? 'Update' : 'Set'}</button>
              {opAvailable && (
                <button onClick={startOp} disabled={saving} className={btnGhost} title="Pull this value from a 1Password vault">
                  1Password…
                </button>
              )}
              {v.set && <button onClick={clear} disabled={saving} className={btnDanger}>Clear</button>}
            </div>
          )}
          {editing && (
            <div className="flex items-center justify-end gap-1">
              <button onClick={save} disabled={saving} className={btnPrimary}>{saving ? '…' : 'Save'}</button>
              <button onClick={cancel} disabled={saving} className={btnGhost}>Cancel</button>
            </div>
          )}
          {opOpen && (
            <div className="flex items-center justify-end gap-1">
              <button onClick={pullOp} disabled={opPulling} className={btnPrimary}>{opPulling ? '…' : 'Pull'}</button>
              <button onClick={cancelOp} disabled={opPulling} className={btnGhost}>Cancel</button>
            </div>
          )}
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={4} className="px-3 pb-2 bg-gray-50">
            <div className="flex items-center gap-2">
              <input
                type={show ? 'text' : 'password'}
                value={value}
                onChange={e => setValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
                placeholder={`new value for ${v.envVar}`}
                autoFocus
                className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded font-mono" />
              <button onClick={() => setShow(s => !s)} className={btnGhost}>{show ? 'Hide' : 'Show'}</button>
            </div>
            {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
          </td>
        </tr>
      )}
      {opOpen && (
        <tr>
          <td colSpan={4} className="px-3 pb-2 bg-emerald-50/60">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={opRef}
                onChange={e => setOpRef(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') pullOp(); if (e.key === 'Escape') cancelOp(); }}
                placeholder={`op://Development/${provider}/credential`}
                autoFocus
                className="flex-1 px-2 py-1 text-xs border border-emerald-300 rounded font-mono bg-white" />
            </div>
            <p className="mt-1 text-[10px] text-gray-700">
              Runs <code className="bg-white px-1 rounded font-mono">op read</code> on the host. The <code className="font-mono">op://</code> reference
              is logged in <code className="font-mono">~/.cx/credential-audit.jsonl</code>; the resolved value is stored in <code className="font-mono">~/.construct/config.env</code> (mode 0600) the same way as a manual paste.
            </p>
            {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
          </td>
        </tr>
      )}
    </Fragment>
  );
}
