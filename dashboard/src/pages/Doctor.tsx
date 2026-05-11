/**
 * Doctor — L0 daemon status, audit log, cost burn, approval queue, pending role invocations.
 * Pulls /api/doctor and refreshes every 30s. Read-only.
 */
import { useEffect, useState } from 'react';

const BASE_URL = '/api';
const REFRESH_MS = 30_000;

type DaemonState = { pid: number; startedAt: number; updatedAt: number; watchers: string[] } | null;
type AuditEntry = {
  ts: number;
  kind: string;
  watcher: string;
  action?: string | null;
  target?: string | null;
  result?: string;
  summary?: string;
};
type Approval = { ts: number; personaId: string; cxId: string; action: string; target: string; reason: string };
type Pending = { ts: number; cxId: string; bdIssueId?: string; eventType: string; summary?: string };
type CostByPersona = Record<string, { spent: number; cap: number; invocations: number }>;
type Doctor = {
  daemon: DaemonState;
  audit: AuditEntry[];
  cost: { dayKey: string; total: { spent: number; cap: number; invocations: number }; byPersona: CostByPersona };
  approvals: Approval[];
  pendingRoleInvocations: Pending[];
  onboardedPersonas: string[];
};

function fmt(ts: number) {
  if (!ts) return '—';
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
}
function ago(ts: number) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

export default function Doctor() {
  const [data, setData] = useState<Doctor | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(`${BASE_URL}/doctor?limit=100`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json: Doctor = await r.json();
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  if (error && !data) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-2">Doctor</h1>
        <p className="text-red-600">Failed to load /api/doctor: {error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-2">Doctor</h1>
        <p className="text-gray-600">Loading…</p>
      </div>
    );
  }

  const totalPct = data.cost.total.cap > 0 ? (data.cost.total.spent / data.cost.total.cap) * 100 : 0;
  const personaRows = Object.entries(data.cost.byPersona).sort((a, b) => b[1].spent - a[1].spent);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Doctor</h1>
        <span className="text-xs text-gray-500">Auto-refreshes every {REFRESH_MS / 1000}s</span>
      </div>

      <section className="rounded-lg border border-gray-200 p-4 bg-white">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">L0 daemon</h2>
        {data.daemon ? (
          <div className="space-y-1 text-sm">
            <div><span className="text-gray-500">Status:</span> <span className="text-green-600 font-medium">running</span></div>
            <div><span className="text-gray-500">PID:</span> {data.daemon.pid}</div>
            <div><span className="text-gray-500">Started:</span> {fmt(data.daemon.startedAt)} ({ago(data.daemon.startedAt)})</div>
            <div><span className="text-gray-500">Last state write:</span> {fmt(data.daemon.updatedAt)} ({ago(data.daemon.updatedAt)})</div>
            <div><span className="text-gray-500">Watchers:</span> {data.daemon.watchers?.join(', ') || '—'}</div>
          </div>
        ) : (
          <p className="text-sm text-gray-600">Doctor not running. Start with <code className="px-1 py-0.5 bg-gray-100 rounded">construct up</code>.</p>
        )}
      </section>

      <section className="rounded-lg border border-gray-200 p-4 bg-white">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Cost — {data.cost.dayKey}</h2>
        <div className="mb-3">
          <div className="flex justify-between text-sm mb-1">
            <span>Total: ${data.cost.total.spent.toFixed(4)} / ${data.cost.total.cap.toFixed(2)}</span>
            <span className="text-gray-500">{data.cost.total.invocations} invocations</span>
          </div>
          <div className="h-2 bg-gray-100 rounded overflow-hidden">
            <div
              className={`h-full ${totalPct >= 80 ? 'bg-red-500' : totalPct >= 50 ? 'bg-yellow-500' : 'bg-emerald-500'}`}
              style={{ width: `${Math.min(100, totalPct)}%` }}
            />
          </div>
        </div>
        {personaRows.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="py-1 pr-4">Persona</th>
                <th className="py-1 pr-4">Spent</th>
                <th className="py-1 pr-4">Cap</th>
                <th className="py-1">Invocations</th>
              </tr>
            </thead>
            <tbody>
              {personaRows.map(([id, c]) => (
                <tr key={id} className="border-b border-gray-50">
                  <td className="py-1 pr-4 font-mono">cx-{id}</td>
                  <td className="py-1 pr-4">${c.spent.toFixed(4)}</td>
                  <td className="py-1 pr-4 text-gray-500">${c.cap.toFixed(2)}</td>
                  <td className="py-1">{c.invocations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-500">No per-persona spend recorded today.</p>
        )}
      </section>

      <section className="rounded-lg border border-gray-200 p-4 bg-white">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Approval requests ({data.approvals.length})</h2>
        {data.approvals.length === 0 ? (
          <p className="text-sm text-gray-500">No pending approval requests.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {data.approvals.map((a) => (
              <li key={`${a.ts}-${a.target}`} className="flex items-start gap-3">
                <span className="text-xs text-gray-400 font-mono whitespace-nowrap mt-0.5">{ago(a.ts)}</span>
                <span className="text-xs px-1.5 py-0.5 bg-amber-50 text-amber-800 rounded font-medium">{a.cxId}</span>
                <span className="text-xs text-gray-500">{a.action}</span>
                <span className="font-mono text-xs break-all flex-1">{a.target}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-gray-200 p-4 bg-white">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Pending role invocations ({data.pendingRoleInvocations.length})</h2>
        {data.pendingRoleInvocations.length === 0 ? (
          <p className="text-sm text-gray-500">No pending invocations queued.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {data.pendingRoleInvocations.map((p) => (
              <li key={`${p.ts}-${p.bdIssueId}`} className="flex items-start gap-3">
                <span className="text-xs text-gray-400 font-mono whitespace-nowrap mt-0.5">{ago(p.ts)}</span>
                <span className="text-xs px-1.5 py-0.5 bg-violet-50 text-violet-800 rounded font-medium">{p.cxId}</span>
                <span className="text-xs text-gray-500 whitespace-nowrap">{p.bdIssueId || '—'}</span>
                <span className="text-xs text-gray-500 whitespace-nowrap">{p.eventType}</span>
                <span className="flex-1 text-gray-700">{p.summary || ''}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-gray-200 p-4 bg-white">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Recent audit ({data.audit.length})</h2>
        {data.audit.length === 0 ? (
          <p className="text-sm text-gray-500">No audit entries yet.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100 sticky top-0 bg-white">
                  <th className="py-1 pr-3">Time</th>
                  <th className="py-1 pr-3">Watcher</th>
                  <th className="py-1 pr-3">Kind</th>
                  <th className="py-1 pr-3">Action</th>
                  <th className="py-1">Summary</th>
                </tr>
              </thead>
              <tbody>
                {data.audit.map((e, i) => (
                  <tr key={`${e.ts}-${i}`} className="border-b border-gray-50">
                    <td className="py-1 pr-3 text-gray-500 whitespace-nowrap">{fmt(e.ts)}</td>
                    <td className="py-1 pr-3">{e.watcher}</td>
                    <td className="py-1 pr-3 text-gray-500">{e.kind}</td>
                    <td className="py-1 pr-3 text-gray-700">{e.action || ''}</td>
                    <td className="py-1 text-gray-700">{e.summary || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs text-gray-400">
        Onboarded personas ({data.onboardedPersonas.length}/28): {data.onboardedPersonas.map((p) => `cx-${p}`).join(', ')}
      </p>
    </div>
  );
}
