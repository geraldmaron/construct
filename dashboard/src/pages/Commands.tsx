import { useEffect, useState } from 'react';
import { fetchStatus } from '../lib/api';

export default function Commands() {
  const [cliCommands, setCliCommands] = useState<any[]>([]);
  const [slashCommands, setSlashCommands] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStatus()
      .then(d => { setCliCommands(d.cliCommands ?? []); setSlashCommands(d.commands ?? []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-20 text-gray-400">Loading...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Commands</h1>
      {cliCommands.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">CLI</h2>
          <div className="grid grid-cols-1 gap-2">
            {cliCommands.map((c: any, i: number) => (
              <div key={i} className="bg-white border border-gray-200 rounded-lg px-4 py-3">
                <p className="font-mono text-sm font-medium">construct {c.name}</p>
                <p className="text-sm text-gray-500">{c.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {slashCommands.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Slash</h2>
          <div className="grid grid-cols-1 gap-4">
            {slashCommands.map((d: any, i: number) => (
              <div key={i} className="bg-white border border-gray-200 rounded-xl p-5">
                <p className="font-semibold mb-2">{d.domain}</p>
                <div className="flex flex-wrap gap-2">
                  {(d.commands ?? []).map((c: any, j: number) => (
                    <span key={j} className="bg-gray-100 text-gray-700 text-xs px-2 py-1 rounded-full font-mono">{c.slash}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {cliCommands.length === 0 && slashCommands.length === 0 && (
        <div className="text-center py-20 text-gray-400">No commands found.</div>
      )}
    </div>
  );
}
