import { useEffect, useState } from 'react';
import { fetchStatus } from '../lib/api';

export default function Agents() {
  const [personas, setPersonas] = useState<any[]>([]);
  const [specialists, setSpecialists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStatus()
      .then(d => { setPersonas(d.personas ?? []); setSpecialists(d.specialists ?? []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-20 text-gray-400">Loading...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Agents</h1>
      {personas.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Entry Points</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {personas.map((p, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-xl p-5">
                <p className="font-semibold">{p.name}</p>
                <p className="text-sm text-gray-500 mb-2">{p.role}</p>
                <p className="text-sm text-gray-600">{p.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {specialists.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Specialists</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {specialists.map((s, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-xl p-5">
                <p className="font-semibold">{s.name}</p>
                <p className="text-sm text-gray-600">{s.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {personas.length === 0 && specialists.length === 0 && (
        <div className="text-center py-20 text-gray-400">No agents found.</div>
      )}
    </div>
  );
}
