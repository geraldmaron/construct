import { useEffect, useState } from 'react';
import { fetchConfig } from '../lib/api';

export default function Config() {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchConfig().then(setConfig).catch(() => {}).finally(() => setLoading(false)); }, []);

  if (loading) return <div className="text-center py-20 text-gray-400">Loading...</div>;
  if (!config) return <div className="text-center py-20 text-gray-400">No config data.</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Config</h1>
      <div className="grid grid-cols-1 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Environment Variables</p>
          <pre className="bg-gray-50 p-4 rounded-lg text-xs overflow-auto max-h-64">{config.env || '(empty)'}</pre>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Embed Config</p>
          <pre className="bg-gray-50 p-4 rounded-lg text-xs overflow-auto max-h-64">{config.embed || '(empty)'}</pre>
        </div>
        {config.roles && (
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Roles</p>
            <p className="text-sm">Primary: <span className="font-semibold">{config.roles.primary || '(none)'}</span></p>
            <p className="text-sm mt-1">Secondary: <span className="font-semibold">{config.roles.secondary || '(none)'}</span></p>
          </div>
        )}
      </div>
    </div>
  );
}
