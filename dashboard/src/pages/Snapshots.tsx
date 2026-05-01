import { useEffect, useState } from 'react';
import { fetchSnapshots } from '../lib/api';

export default function Snapshots() {
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchSnapshots().then(d => setSnapshots(d.snapshots ?? [])).catch(() => {}).finally(() => setLoading(false)); }, []);

  if (loading) return <div className="text-center py-20 text-gray-400">Loading...</div>;
  if (!snapshots.length) return <div className="text-center py-20 text-gray-400">No snapshots recorded yet.</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Snapshots</h1>
      <div className="grid grid-cols-1 gap-4">
        {snapshots.map((s, i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-xl p-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-500">{s.capturedAt ? new Date(s.capturedAt).toLocaleString() : '—'}</span>
              {s.providers && <span className="text-xs text-gray-400">{s.providers.join(', ')}</span>}
            </div>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{s.summary ?? JSON.stringify(s).slice(0, 300)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
