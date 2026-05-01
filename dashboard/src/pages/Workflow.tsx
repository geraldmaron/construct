import { useEffect, useState } from 'react';

const BASE_URL = '/api';

export default function Workflow() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('plan');

  useEffect(() => {
    fetch(`${BASE_URL}/workflow`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-20 text-gray-400">Loading...</div>;
  if (error) return <div className="text-center py-20 text-red-500">{error}</div>;
  if (!data) return <div className="text-center py-20 text-gray-400">No workflow data available.</div>;

  const counts = data.taskStatusCounts ?? {};
  const wf = data.workflowState;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Workflow</h1>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {['plan', 'tasks', 'phases'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {t.charAt(0).toUpperCase() + t.slice(1)}</button>
          ))}
        </div>
      </div>

      {/* Status summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {[
          { label: 'Pending', value: counts.todo ?? 0, color: 'bg-gray-100 text-gray-700' },
          { label: 'In Progress', value: counts.inProgress ?? 0, color: 'bg-blue-100 text-blue-700' },
          { label: 'Blocked', value: counts.blocked ?? 0, color: 'bg-red-100 text-red-700' },
          { label: 'Done', value: counts.done ?? 0, color: 'bg-green-100 text-green-700' },
          { label: 'Skipped', value: counts.skipped ?? 0, color: 'bg-gray-100 text-gray-500' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-gray-200 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold">{s.value}</p>
            <p className={`text-xs font-medium mt-0.5 inline-block px-2 py-0.5 rounded-full ${s.color}`}>{s.label}</p>
          </div>
        ))}
      </div>

      {tab === 'plan' && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Plan</p>
            {data.hasPlan && <span className="text-xs text-gray-400 font-mono">plan.md</span>}
          </div>
          {data.hasPlan ? (
            <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{data.planSummary || 'No summary'}</pre>
          ) : (
            <p className="text-gray-400">No plan.md found.</p>
          )}
        </div>
      )}

      {tab === 'tasks' && wf && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-6 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide">{data.taskCount} Tasks</p>
          </div>
          {(wf.tasks ?? []).length === 0 ? (
            <div className="p-6 text-center text-gray-400">No tasks defined.</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {(wf.tasks ?? []).map((task: any, i: number) => {
                const statusColor = task.status === 'done' ? 'bg-green-100 text-green-700'
                  : task.status === 'in-progress' ? 'bg-blue-100 text-blue-700'
                  : task.status?.startsWith('blocked') ? 'bg-red-100 text-red-700'
                  : task.status === 'skipped' ? 'bg-gray-100 text-gray-500'
                  : 'bg-gray-100 text-gray-500';
                return (
                  <div key={i} className="px-6 py-4">
                    <div className="flex items-center justify-between mb-1">
                      <p className="font-medium text-sm">{task.title || task.key || `Task ${i + 1}`}</p>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColor}`}>{task.status || 'todo'}</span>
                    </div>
                    {task.phase && <p className="text-xs text-gray-400 font-mono">{task.phase}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'phases' && wf && (
        <div className="grid grid-cols-1 gap-3">
          {Object.entries(wf.phases ?? {}).map(([key, phase]: [string, any]) => {
            const statusColor = phase.status === 'done' ? 'bg-green-100 text-green-700'
              : phase.status === 'in-progress' ? 'bg-blue-100 text-blue-700'
              : 'bg-gray-100 text-gray-500';
            const isCurrent = key === wf.phase;
            return (
              <div key={key} className={`bg-white border rounded-xl p-5 ${isCurrent ? 'border-indigo-300 ring-1 ring-indigo-100' : 'border-gray-200'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold capitalize">{key}</p>
                    {isCurrent && <span className="text-xs text-indigo-600 font-medium">current</span>}
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColor}`}>{phase.status || 'todo'}</span>
                </div>
                {phase.summary && <p className="text-sm text-gray-500">{phase.summary}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
