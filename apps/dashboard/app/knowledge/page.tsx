/** Knowledge — ask the corpus + browse index via /api/knowledge/*. */
'use client';

import { useState } from 'react';
import { Section, Callout, CodeBlock } from '@cx/ui';
import { Page, CardGrid, StatCard, EmptyState, Spinner, DataTable } from '@/components/page';
import { useApi } from '@/components/use-api';
import { fetchKnowledgeIndex, fetchKnowledgeTrends, fetchKnowledgeAsk } from '@/lib/api';

type IndexPayload = { total?: number; sources?: Record<string, number> };
type AskResponse = { answer?: string; sources?: { path?: string; score?: number; snippet?: string }[] };

export default function KnowledgePage() {
  const idx = useApi<IndexPayload>(fetchKnowledgeIndex);
  const trends = useApi(fetchKnowledgeTrends);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [response, setResponse] = useState<AskResponse | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

  const ask = async () => {
    if (!question.trim()) return;
    setAsking(true);
    setAskError(null);
    setResponse(null);
    try {
      const r = await fetchKnowledgeAsk(question);
      setResponse(r);
    } catch (e) {
      setAskError(e instanceof Error ? e.message : String(e));
    } finally {
      setAsking(false);
    }
  };

  return (
    <Page
      eyebrow="knowledge · RAG"
      title="Knowledge"
      lede="Hybrid BM25 + cosine search over the project corpus. Ask in natural language; the dashboard runs the retrieval pipeline and returns top-k passages with sources."
      meta={<span className="pill">{idx.data?.total ?? '…'} chunks indexed</span>}
    >
      {idx.error && <EmptyState label="Failed to load index" hint={idx.error} />}
      {idx.data && (
        <CardGrid>
          <StatCard label="Total chunks" value={idx.data.total ?? 0} />
          {Object.entries(idx.data.sources ?? {}).slice(0, 3).map(([k, v]) => (
            <StatCard key={k} label={k} value={v} sub="chunks" />
          ))}
        </CardGrid>
      )}

      <Section num="01" title="Ask the corpus" defaultOpen tldr="Hybrid retrieval returns top-k passages with source paths. Use it to ground decisions in durable docs.">
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', margin: '12px 0' }}>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') ask(); }}
            placeholder="e.g. how does the intake watcher classify packets?"
            style={{
              flex: 1,
              padding: '10px 14px',
              background: 'var(--surface)',
              border: '1px solid var(--hairline)',
              borderRadius: 8,
              color: 'var(--ink)',
              fontSize: 14,
              fontFamily: 'var(--sans)',
            }}
          />
          <button className="btn primary" onClick={ask} disabled={asking || !question.trim()} type="button">
            {asking ? 'Asking…' : 'Ask'}
          </button>
        </div>
        {askError && <EmptyState label="Failed" hint={askError} />}
        {response && (
          <>
            <Callout label="Answer">
              <p style={{ whiteSpace: 'pre-wrap' }}>{response.answer ?? '(no answer)'}</p>
            </Callout>
            {response.sources && response.sources.length > 0 && (
              <>
                <h4>Sources</h4>
                <DataTable
                  columns={['Score', 'Path', 'Snippet']}
                  rows={response.sources.map((s) => [
                    s.score?.toFixed(3) ?? '—',
                    <code key="p" style={{ fontSize: 11 }}>{s.path ?? '—'}</code>,
                    s.snippet ?? '—',
                  ])}
                />
              </>
            )}
          </>
        )}
      </Section>

      <Section num="02" title="Corpus breakdown" tldr="Chunks per source category.">
        {idx.data?.sources ? (
          <DataTable
            columns={['Source', 'Chunks']}
            rows={Object.entries(idx.data.sources).map(([k, v]) => [<code key="k">{k}</code>, v])}
          />
        ) : (
          <Spinner />
        )}
      </Section>

      <Section num="03" title="Trends" tldr="Recent corpus activity.">
        {trends.loading && !trends.data && <Spinner />}
        {trends.error && <EmptyState label="Failed to load" hint={trends.error} />}
        {trends.data && (
          <CodeBlock title="trend report" lang="json">{JSON.stringify(trends.data, null, 2)}</CodeBlock>
        )}
      </Section>
    </Page>
  );
}
