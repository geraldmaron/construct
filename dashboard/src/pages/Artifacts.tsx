import { useEffect, useState } from 'react';
import { fetchArtifacts } from '../lib/api';

export default function Artifacts() {
  const [artifacts, setArtifacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');

  useEffect(() => { fetchArtifacts().then(d => setArtifacts(d.artifacts ?? [])).catch(() => {}).finally(() => setLoading(false)); }, []);

  const filtered = tab === 'all' ? artifacts : artifacts.filter(a => a.type === tab);

  if (loading) return <div className="text-center py-20 text-gray-400">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Artifacts</h1>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {['all', 'prd', 'adr', 'rfc'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{t.toUpperCase()}</button>
          ))}
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400">No {tab === 'all' ? '' : tab.toUpperCase()} artifacts.</div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {filtered.map((a, i) => (
            <div key={i} className="bg-white border border-gray-200 rounded-xl p-5 flex items-start justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">{a.type}</span>
                <p className="font-semibold mt-0.5">{a.title}</p>
                <p className="text-xs text-gray-400 font-mono mt-1">{a.relativePath ?? ''}</p>
              </div>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                a.status === 'healthy' ? 'bg-green-100 text-green-800' :
                a.status === 'degraded' ? 'bg-yellow-100 text-yellow-800' :
                a.status === 'unavailable' ? 'bg-red-100 text-red-800' :
                'bg-gray-100 text-gray-600'
              }`}>{a.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
