import { useEffect, useState } from 'react';
import { fetchRegistry } from '../lib/api';

export default function Models() {
  const [models, setModels] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchRegistry().then(d => setModels(d.models ?? {})).catch(() => {}).finally(() => setLoading(false)); }, []);

  if (loading) return <div className="text-center py-20 text-gray-400">Loading...</div>;

  const tiers = ['reasoning', 'standard', 'fast'];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Model Tiers</h1>
      <div className="grid grid-cols-1 gap-4">
        {tiers.map(t => {
          const cfg = models[t];
          return (
            <div key={t} className="bg-white border border-gray-200 rounded-xl p-6">
              <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{t}</p>
              {cfg ? (
                <div>
                  <p className="text-lg font-semibold">{cfg.primary ?? '—'}</p>
                  {cfg.fallback?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {cfg.fallback.map((m: string, j: number) => <span key={j} className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">{m}</span>)}
                    </div>
                  )}
                </div>
              ) : <p className="text-gray-400">Not configured</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
