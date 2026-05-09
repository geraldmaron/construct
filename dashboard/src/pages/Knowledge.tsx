import { useState } from 'react';
import { fetchKnowledgeTrends, fetchKnowledgeIndex, fetchKnowledgeAsk } from '../lib/api';

export default function Knowledge() {
  const [tab, setTab] = useState('ask');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<any>(null);
  const [trends, setTrends] = useState<any>(null);
  const [idx, setIdx] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const doAsk = async () => {
    if (!question.trim()) return;
    setLoading(true);
    try { setAnswer(await fetchKnowledgeAsk(question)); } catch {}
    setLoading(false);
  };

  const loadTrends = async () => { setLoading(true); try { setTrends(await fetchKnowledgeTrends()); } catch {} setLoading(false); };
  const loadIndex = async () => { setLoading(true); try { setIdx(await fetchKnowledgeIndex()); } catch {} setLoading(false); };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Knowledge</h1>
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-6 w-fit">
        {['ask', 'trends', 'index'].map(t => (
          <button key={t} onClick={() => { setTab(t); if (t === 'trends') loadTrends(); if (t === 'index') loadIndex(); }}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
        ))}
      </div>

      {tab === 'ask' && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="flex gap-3 mb-4">
            <input value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => e.key === 'Enter' && doAsk()}
              placeholder='e.g. "what are the biggest risks?"'
              className="flex-1 border border-gray-200 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-indigo-400" />
            <button onClick={doAsk} disabled={loading}
              className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:from-indigo-700 hover:to-violet-700 transition-colors disabled:opacity-50">Ask</button>
          </div>
          {loading && <p className="text-sm text-gray-400">Thinking...</p>}
          {answer && (
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm whitespace-pre-wrap">{answer.answer}</p>
              {answer.sources?.length > 0 && (
                <div className="mt-3 text-xs text-gray-400">
                  <p className="font-medium mb-1">Sources:</p>
                  {answer.sources.slice(0, 5).map((s: any, i: number) => <p key={i}>[{s.source}] {s.title}</p>)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'trends' && trends && (
        <div className="grid grid-cols-1 gap-4">
          {trends.hotTopics?.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <p className="font-semibold mb-3">Hot Topics</p>
              <div className="flex flex-wrap gap-2">
                {trends.hotTopics.map((t: any, i: number) => (
                  <span key={i} style={{ fontSize: `${12 + t.weightedFrequency * 8}px` }}
                    className="bg-gradient-to-r from-indigo-50 to-violet-50 text-indigo-700 px-2 py-0.5 rounded-full">{t.term}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'index' && idx && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <p className="font-semibold mb-2">Corpus — {idx.total} total chunks</p>
          <div className="space-y-1">
            {Object.entries(idx.sources ?? {}).map(([src, count]: [string, any], i: number) => (
              <p key={i} className="text-sm text-gray-600">{src}: {count} chunks</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
