import { useEffect, useState } from 'react';
import { fetchApprovals } from '../lib/api';

export default function Approvals() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => fetchApprovals().then(d => setItems(d.items ?? [])).catch(() => {}).finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  if (loading) return <div className="text-center py-20 text-gray-400">Loading...</div>;
  if (!items.length) return <div className="text-center py-20 text-gray-400">No pending approvals.</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Approval Queue</h1>
      <div className="grid grid-cols-1 gap-4">
        {items.map((item, i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-xl p-6">
            <p className="text-xs text-gray-400 font-mono mb-1">{item.id}</p>
            <p className="text-gray-700 mb-4">{item.description || item.action || JSON.stringify(item)}</p>
            <div className="flex gap-3">
              <span className="bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded-full">{item.pattern ?? 'standard'}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
