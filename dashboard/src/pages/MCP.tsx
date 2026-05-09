import { useEffect, useState } from 'react';
import { fetchRegistry } from '../lib/api';

export default function MCP() {
  const [servers, setServers] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchRegistry().then(d => setServers(d.mcpServers ?? {})).catch(() => {}).finally(() => setLoading(false)); }, []);

  if (loading) return <div className="text-center py-20 text-gray-400">Loading...</div>;

  const entries = Object.entries(servers);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">MCP Servers</h1>
      {entries.length === 0 ? (
        <div className="text-center py-20 text-gray-400">No MCP servers configured.</div>
      ) : entries.map(([id, s]) => (
        <div key={id} className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="font-semibold">{id}</p>
            <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">{s.type ?? 'stdio'}</span>
          </div>
          <p className="text-sm text-gray-500 mb-2">{s.description ?? s.command ?? s.url ?? ''}</p>
          {s.command && <p className="text-xs text-gray-400 font-mono">{s.command} {Array.isArray(s.args) ? s.args.join(' ') : ''}</p>}
        </div>
      ))}
    </div>
  );
}
