import { useEffect, useState } from 'react';
import { fetchAuthStatus, fetchStatus } from '../lib/api';

interface StatusData {
  version?: string;
  lastSync?: string;
  system?: { overall?: { status?: string; summary?: string } };
  features?: Array<{ name: string; description: string; status: string }>;
  services?: Array<{ name: string; status: string; note?: string }>;
  auth?: {
    mode?: string;
    providers?: string[];
    tokenConfigured?: boolean;
  };
}

export default function Resources() {
  const [data, setData] = useState<StatusData | null>(null);
  const [auth, setAuth] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetchStatus().then(setData),
      fetchAuthStatus().then(setAuth),
    ])
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-20 text-gray-400">Loading...</div>;
  if (error) return <div className="text-center py-20 text-red-500">{error}</div>;
  if (!data) return <div className="text-center py-20 text-gray-400">No data</div>;

  const health = data.system?.overall?.status ?? 'unknown';

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Resources</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <p className="text-sm text-gray-500 mb-1">Version</p>
          <p className="text-xl font-semibold">{data.version ?? '—'}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <p className="text-sm text-gray-500 mb-1">Health</p>
          <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${
            health === 'healthy' ? 'bg-green-100 text-green-800' :
            health === 'degraded' ? 'bg-yellow-100 text-yellow-800' :
            'bg-red-100 text-red-800'
          }`}>{health}</span>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <p className="text-sm text-gray-500 mb-1">Auth Mode</p>
          <p className="text-xl font-semibold">{auth?.auth?.mode ?? 'token'}</p>
          <p className="text-xs text-gray-500 mt-2">
            {auth?.auth?.providers?.length
              ? `Providers: ${auth.auth.providers.join(', ')}`
              : auth?.auth?.tokenConfigured
                ? 'Shared token auth is configured'
                : 'Open local mode until a token is configured'}
          </p>
        </div>
      </div>

      <h2 className="text-lg font-semibold mb-4">Features</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(data.features ?? []).map((f, i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="font-semibold mb-1">{f.name}</h3>
            <p className="text-sm text-gray-500 mb-3">{f.description}</p>
            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
              f.status === 'healthy' ? 'bg-green-100 text-green-800' :
              f.status === 'degraded' ? 'bg-yellow-100 text-yellow-800' :
              f.status === 'unavailable' ? 'bg-red-100 text-red-800' :
              'bg-gray-100 text-gray-600'
            }`}>{f.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
