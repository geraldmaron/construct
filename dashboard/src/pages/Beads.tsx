/**
 * dashboard/src/pages/Beads.tsx — human-readable view of the bd issue tracker.
 *
 * Reads `.beads/issues.jsonl` via `GET /api/beads`. Compact table with
 * status + priority filters, summary chips, and per-row description toggle.
 * Read-only for now — bd CLI remains the write surface.
 */

import { useEffect, useMemo, useState } from 'react';
import { fetchBeads } from '../lib/api';

type Issue = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  issue_type: string | null;
  owner: string | null;
  created_at: string;
  updated_at: string;
  dependency_count: number;
  dependent_count: number;
  comment_count: number;
  labels: string[];
};
type BeadsResponse = {
  issues: Issue[];
  counts: { total: number; byStatus: Record<string, number>; byPriority: Record<string, number> };
};

const STATUS_ORDER = ['open', 'in_progress', 'blocked', 'closed', 'deferred'];
const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  in_progress: 'In progress',
  blocked: 'Blocked',
  closed: 'Closed',
  deferred: 'Deferred',
};
const STATUS_DOT: Record<string, string> = {
  open: 'bg-gray-400',
  in_progress: 'bg-blue-500',
  blocked: 'bg-red-500',
  closed: 'bg-green-500',
  deferred: 'bg-gray-300',
};
const STATUS_BADGE: Record<string, string> = {
  open: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-blue-100 text-blue-800',
  blocked: 'bg-red-100 text-red-800',
  closed: 'bg-green-100 text-green-800',
  deferred: 'bg-gray-100 text-gray-700',
};
const PRIORITY_BADGE: Record<number, string> = {
  0: 'bg-red-100 text-red-800',
  1: 'bg-orange-100 text-orange-800',
  2: 'bg-yellow-100 text-yellow-800',
  3: 'bg-gray-100 text-gray-700',
};

const btnGhost = 'px-2.5 py-1 text-xs font-medium rounded border border-gray-300 bg-white text-gray-800 hover:bg-gray-100 transition-colors disabled:opacity-50';
const chipBase = 'px-2.5 py-1 text-xs font-medium rounded-full border transition-colors';

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return iso.slice(0, 10);
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  return `${mo}mo ago`;
}

export default function Beads() {
  const [data, setData] = useState<BeadsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('open');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = () => fetchBeads().then(setData).catch(() => {});

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  const visibleIssues = useMemo(() => {
    if (!data) return [];
    let out = data.issues;
    if (statusFilter !== 'all') out = out.filter(i => i.status === statusFilter);
    if (priorityFilter !== 'all') out = out.filter(i => `P${i.priority}` === priorityFilter);
    return [...out].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  }, [data, statusFilter, priorityFilter]);

  const toggle = (id: string) => setExpanded(s => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  if (loading) return <div className="text-center py-20 text-gray-600">Loading...</div>;
  if (!data) return <div className="text-center py-20 text-gray-600">No bead data.</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Beads <span className="text-gray-600 font-normal text-sm">— {data.counts.total} issues</span></h1>
        <button onClick={load} className={btnGhost}>Refresh</button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide mr-1">Status</span>
        <Chip label={`All (${data.counts.total})`} active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
        {STATUS_ORDER.map(s => {
          const count = data.counts.byStatus[s] || 0;
          if (count === 0 && s !== 'open') return null;
          return (
            <Chip key={s} label={`${STATUS_LABEL[s]} (${count})`} active={statusFilter === s} onClick={() => setStatusFilter(s)} dotClass={STATUS_DOT[s]} />
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide mr-1">Priority</span>
        <Chip label="All" active={priorityFilter === 'all'} onClick={() => setPriorityFilter('all')} />
        {[0, 1, 2, 3].map(p => {
          const key = `P${p}`;
          const count = data.counts.byPriority[key] || 0;
          if (count === 0) return null;
          return (
            <Chip key={p} label={`${key} (${count})`} active={priorityFilter === key} onClick={() => setPriorityFilter(key)} />
          );
        })}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr className="text-xs uppercase tracking-wide text-gray-700">
              <th className="text-left px-3 py-1.5 font-semibold w-14">Pri</th>
              <th className="text-left px-3 py-1.5 font-semibold w-28">Status</th>
              <th className="text-left px-3 py-1.5 font-semibold">Title</th>
              <th className="text-left px-3 py-1.5 font-semibold w-32">Owner</th>
              <th className="text-left px-3 py-1.5 font-semibold w-24">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visibleIssues.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-gray-600">No issues match these filters.</td></tr>
            ) : visibleIssues.map(it => (
              <IssueRow key={it.id} it={it} expanded={expanded.has(it.id)} onToggle={() => toggle(it.id)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Chip({ label, active, onClick, dotClass }: { label: string; active: boolean; onClick: () => void; dotClass?: string }) {
  const cls = active
    ? `${chipBase} bg-indigo-600 border-indigo-600 text-white`
    : `${chipBase} bg-white border-gray-300 text-gray-800 hover:bg-gray-100`;
  return (
    <button onClick={onClick} className={cls}>
      {dotClass && <span className={`inline-block h-1.5 w-1.5 rounded-full mr-1.5 align-middle ${dotClass}`}></span>}
      {label}
    </button>
  );
}

function IssueRow({ it, expanded, onToggle }: { it: Issue; expanded: boolean; onToggle: () => void }) {
  const ownerShort = it.owner ? it.owner.split('@')[0] : '—';
  return (
    <>
      <tr className="hover:bg-gray-50 cursor-pointer" onClick={onToggle}>
        <td className="px-3 py-1.5">
          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${PRIORITY_BADGE[it.priority] || 'bg-gray-100 text-gray-700'}`}>P{it.priority}</span>
        </td>
        <td className="px-3 py-1.5">
          <span className={`text-xs px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${STATUS_BADGE[it.status] || 'bg-gray-100 text-gray-700'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[it.status] || 'bg-gray-400'}`}></span>
            {STATUS_LABEL[it.status] || it.status}
          </span>
        </td>
        <td className="px-3 py-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm text-gray-900 truncate">{it.title}</span>
            <code className="text-xs text-gray-600 font-mono flex-shrink-0">{it.id}</code>
            {it.issue_type && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 flex-shrink-0">{it.issue_type}</span>}
            {it.dependency_count > 0 && <span className="text-xs text-gray-600 flex-shrink-0">⟵ {it.dependency_count}</span>}
            {it.dependent_count > 0 && <span className="text-xs text-gray-600 flex-shrink-0">⟶ {it.dependent_count}</span>}
            {it.comment_count > 0 && <span className="text-xs text-gray-600 flex-shrink-0">💬 {it.comment_count}</span>}
          </div>
        </td>
        <td className="px-3 py-1.5">
          <span className="text-xs text-gray-700 truncate" title={it.owner || ''}>{ownerShort}</span>
        </td>
        <td className="px-3 py-1.5">
          <span className="text-xs text-gray-700" title={it.updated_at}>{ago(it.updated_at)}</span>
        </td>
      </tr>
      {expanded && it.description && (
        <tr className="bg-gray-50">
          <td colSpan={5} className="px-6 py-3">
            <p className="text-xs text-gray-700 whitespace-pre-wrap">{it.description}</p>
            <p className="text-xs text-gray-600 mt-2">
              Created {ago(it.created_at)} · use <code className="px-1 py-0.5 bg-gray-200 rounded">bd show {it.id}</code> for full details
            </p>
          </td>
        </tr>
      )}
    </>
  );
}
