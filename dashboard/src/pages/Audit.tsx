/**
 * Audit.tsx — append-only audit log viewer.
 *
 * Reads .cx/audit.jsonl entries (newest first) so the operator can see
 * who/when/what for every config / persona / skill / rules edit. Part
 * of Phase 10 — trust-building surface for power users.
 */
import { useEffect, useState } from 'react';

type AuditEntry = {
  ts: string;
  action: string;
  path?: string;
  keys?: string[];
  backupPath?: string | null;
  bytes?: number;
};

export default function Audit() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/audit?limit=200')
      .then((r) => r.json())
      .then((j) => {
        if (j.error) setError(j.error);
        else { setEntries(j.entries); setTotal(j.total); }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-5xl space-y-6">
      <header>
        <p className="text-text-dim text-xs uppercase tracking-wider mb-1">Page</p>
        <h1 className="text-3xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-text-muted text-sm mt-2">
          Every config / persona / skill / rules edit appends a line to <code className="px-1 py-0.5 bg-bg-muted rounded">.cx/audit.jsonl</code>. Newest first.
        </p>
      </header>

      {error && (
        <div className="card" style={{ borderColor: 'var(--status-down)' }}>
          <p className="text-sm">{error}</p>
        </div>
      )}

      {loading && !error && <p className="text-sm text-text-dim">Loading audit entries…</p>}

      {!loading && entries.length === 0 && !error && (
        <section className="card">
          <h2 className="text-lg font-semibold mb-2">No audit entries yet</h2>
          <p className="text-sm text-text-muted">
            The log is created on first config or override edit. Try saving a change in <code className="px-1 py-0.5 bg-bg-muted rounded">/config</code> or <code className="px-1 py-0.5 bg-bg-muted rounded">/personas</code>.
          </p>
        </section>
      )}

      {entries.length > 0 && (
        <section className="card">
          <p className="text-xs text-text-dim mb-3">
            Showing {entries.length} of {total} entries
          </p>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-text-dim">
              <tr>
                <th className="text-left font-normal pb-3 pr-4 whitespace-nowrap">When</th>
                <th className="text-left font-normal pb-3 pr-4">Action</th>
                <th className="text-left font-normal pb-3 pr-4">Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i} className="border-t border-border align-top">
                  <td className="py-2 pr-4 text-xs text-text-dim whitespace-nowrap font-mono">
                    {new Date(e.ts).toLocaleString()}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">{e.action}</td>
                  <td className="py-2 pr-4 text-xs text-text-muted">
                    {e.keys && <div>keys: {e.keys.join(', ')}</div>}
                    {e.bytes != null && <div>bytes: {e.bytes}</div>}
                    {e.backupPath && (
                      <div>backup: <span className="font-mono">{e.backupPath.split('/').slice(-3).join('/')}</span></div>
                    )}
                    {e.path && (
                      <div className="text-text-dim">path: {e.path.split('/').slice(-2).join('/')}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
