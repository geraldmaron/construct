import { useEffect, useState, useRef } from 'react';
import { fetchTerraformFiles } from '../lib/api';

const BASE_URL = '/api';

export default function Infrastructure() {
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    fetchTerraformFiles()
      .then(d => { setFiles(d.files ?? []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (selectedFile) {
      fetch(`${BASE_URL}/terraform/file?path=${encodeURIComponent(selectedFile)}`)
        .then(r => r.json())
        .then(d => { setFileContent(d.content ?? ''); setOriginalContent(d.content ?? ''); })
        .catch(() => {});
    } else {
      setFileContent('');
      setOriginalContent('');
    }
  }, [selectedFile]);

  const isDirty = fileContent !== originalContent;

  const saveFile = async () => {
    if (!selectedFile || !isDirty) return;
    setSaving(true);
    try {
      await fetch(`${BASE_URL}/terraform/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedFile, content: fileContent }),
      });
      setOriginalContent(fileContent);
    } catch {}
    setSaving(false);
  };

  const runCommand = async (subcommand: string) => {
    setRunning(true);
    setOutput('');
    try {
      const res = await fetch(`${BASE_URL}/terraform/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subcommand, environment: 'staging' }),
      });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          setOutput(prev => prev + decoder.decode(value, { stream: true }));
        }
      }
    } catch (e: any) {
      setOutput(`Error: ${e.message}`);
    }
    setRunning(false);
  };

  if (loading) return <div className="text-center py-20 text-gray-400">Loading...</div>;

  return (
    <div className="flex flex-col h-full">
      <h1 className="text-2xl font-bold mb-6">Infrastructure</h1>

      <div className="flex gap-6 flex-1 min-h-0">
        {/* File list */}
        <div className="w-56 flex-shrink-0 bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Terraform Files</p>
          </div>
          <div className="divide-y divide-gray-50">
            {files.length === 0 && (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">No .tf files found.</p>
            )}
            {files.map(f => (
              <button key={f} onClick={() => setSelectedFile(f)}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                  selectedFile === f
                    ? 'bg-gradient-to-r from-indigo-50 to-violet-50 text-indigo-700 font-medium border-r-2 border-indigo-500'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}>{f}</button>
            ))}
          </div>
        </div>

        {/* Editor + Actions */}
        {selectedFile ? (
          <div className="flex-1 flex flex-col min-w-0">
            {/* Toolbar */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-700">{selectedFile}</span>
                {isDirty && <span className="text-yellow-600 text-sm font-medium">● unsaved</span>}
              </div>
              <div className="flex gap-2">
                <button onClick={saveFile} disabled={!isDirty || saving}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:from-indigo-700 hover:to-violet-700 transition-colors disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button onClick={() => runCommand('validate')} disabled={running}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-50">Validate</button>
                <button onClick={() => runCommand('output')} disabled={running}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-50">Outputs</button>
              </div>
            </div>

            {/* Editor */}
            <textarea value={fileContent} onChange={e => setFileContent(e.target.value)}
              className="flex-1 font-mono text-sm p-4 border border-gray-200 rounded-xl resize-none focus:outline-none focus:border-indigo-400 bg-gray-50"
              spellCheck={false} />

            {/* Run buttons */}
            {output !== '' || running ? (
              <div className="mt-4">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Output</p>
                  {running && <span className="text-indigo-600 text-xs animate-pulse">Running...</span>}
                </div>
                <pre ref={outputRef}
                  className="bg-gray-900 text-green-400 text-xs p-4 rounded-xl overflow-auto max-h-64 font-mono leading-relaxed whitespace-pre-wrap">{output || 'Waiting...'}</pre>
              </div>
            ) : (
              <div className="flex gap-2 mt-4">
                <button onClick={() => runCommand('plan')} disabled={running}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition-colors disabled:opacity-50">Plan</button>
                <button onClick={() => runCommand('apply')} disabled={running}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:from-indigo-700 hover:to-violet-700 transition-colors disabled:opacity-50">Apply</button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <p className="text-lg">Select a Terraform file to edit</p>
          </div>
        )}
      </div>
    </div>
  );
}
