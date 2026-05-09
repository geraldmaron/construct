import { useEffect, useState } from 'react';
import { fetchStatus } from '../lib/api';

export default function Hooks() {
  const [hooks, setHooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStatus()
      .then(d => setHooks(d.hooks ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-20 text-gray-400">Loading...</div>;

  const byPhase: Record<string, any[]> = {};
  for (const h of hooks) {
    const p = h.phase ?? 'Other';
    if (!byPhase[p]) byPhase[p] = [];
    byPhase[p].push(h);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Hooks</h1>
      {hooks.length === 0 ? (
        <div className="text-center py-20 text-gray-400">No hooks configured.</div>
      ) : Object.entries(byPhase).map(([phase, items]) => (
        <div key={phase} className="mb-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{phase}</h2>
          <div className="grid grid-cols-1 gap-2">
            {items.map((h: any, i: number) => (
              <div key={i} className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex items-start gap-3">
                <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${h.blocking ? 'bg-yellow-500' : 'bg-gray-300'}`} />
                <div>
                  <p className="text-sm text-gray-700">{h.description}</p>
                  {!h.blocking && <p className="text-xs text-gray-400 mt-0.5">async</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
