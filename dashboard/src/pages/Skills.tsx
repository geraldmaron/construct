import { useEffect, useState } from 'react';
import { fetchStatus } from '../lib/api';

export default function Skills() {
  const [skills, setSkills] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStatus()
      .then(d => setSkills(d.skills ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-20 text-gray-400">Loading...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Skills</h1>
      {skills.length === 0 ? (
        <div className="text-center py-20 text-gray-400">No skills found.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {skills.map((cat: any, i: number) => (
            <div key={i} className="bg-white border border-gray-200 rounded-xl p-5">
              <p className="font-semibold capitalize mb-2">{cat.category}</p>
              <div className="flex flex-wrap gap-1.5">
                {(cat.files ?? []).map((f: string, j: number) => (
                  <span key={j} className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">{f.replace(/\.(md|mjs)$/, '').replace(/-/g, ' ')}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
