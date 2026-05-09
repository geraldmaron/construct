import { useEffect, useState } from 'react';
import { fetchStatus } from '../lib/api';

export default function Plugins() {
  const [plugins, setPlugins] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchStatus().then(d => setPlugins(d.plugins ?? null)).catch(() => {}).finally(() => setLoading(false)); }, []);

  if (loading) return <div className="text-center py-20 text-gray-400">Loading...</div>;
  if (!plugins) return <div className="text-center py-20 text-gray-400">No plugin data.</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Plugins</h1>
      {plugins.status && <p className="text-sm text-gray-500 mb-4">Status: {plugins.status}</p>}
      {plugins.summary && <p className="text-sm text-gray-500 mb-4">{plugins.summary}</p>}
      <div className="grid grid-cols-1 gap-4">
        {(plugins.entries ?? []).map((p: any, i: number) => (
          <div key={i} className="bg-white border border-gray-200 rounded-xl p-5">
            <p className="font-semibold">{p.name}</p>
            <p className="text-sm text-gray-500 mb-2">{p.description}</p>
            <div className="flex flex-wrap gap-2 text-xs text-gray-400">
              <span>{p.id}</span>
              <span>v{p.version}</span>
              {p.builtIn && <span className="bg-gray-100 px-1.5 py-0.5 rounded">built-in</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
