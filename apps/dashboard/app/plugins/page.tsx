/** Plugins — engine layer overrides. */
'use client';

import { Section, Callout } from '@cx/ui';
import { Page, DataTable, Spinner, EmptyState } from '@/components/page';
import { useApi } from '@/components/use-api';
import { apiGet } from '@/lib/api';

type PluginsPayload = {
  layers?: Record<string, { default?: string; active?: string; source?: string }>;
};

const LAYER_LABELS: Record<string, string> = {
  embedder: 'Embedder', chunker: 'Chunker', indexer: 'Indexer',
  fuser: 'Fuser', reranker: 'Reranker', compressor: 'Compressor',
};

export default function PluginsPage() {
  const { data, error, loading } = useApi<PluginsPayload>(() => apiGet('/plugins').catch(() => ({ layers: {} } as PluginsPayload)));
  const layers = data?.layers ?? {};

  return (
    <Page
      eyebrow="specialists · plugins"
      title="Plugin engine"
      lede="Six-layer retrieval pipeline (embedder, chunker, indexer, fuser, reranker, compressor). Each layer resolves to a default unless overridden by config or env."
      meta={<span className="pill">{Object.keys(layers).length} layers</span>}
    >
      {loading && !data && <Spinner />}
      {error && <EmptyState label="Failed to load" hint={error} />}
      {Object.keys(layers).length === 0 && data && (
        <Callout label="All defaults">
          <p>No plugin overrides registered. Engine is running on built-in defaults.</p>
        </Callout>
      )}
      {Object.keys(layers).length > 0 && (
        <Section num="01" title="Layer resolution" defaultOpen>
          <DataTable
            columns={['Layer', 'Active', 'Default', 'Source']}
            rows={Object.entries(layers).map(([k, v]) => [
              LAYER_LABELS[k] ?? k,
              <code key="a">{v.active ?? '—'}</code>,
              <code key="d" style={{ color: 'var(--muted)' }}>{v.default ?? '—'}</code>,
              v.source ?? '—',
            ])}
          />
        </Section>
      )}
    </Page>
  );
}
