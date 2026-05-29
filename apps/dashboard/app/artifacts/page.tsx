/** Artifacts — list generated artifacts via /api/artifacts. */
'use client';

import { useState } from 'react';
import { Section, Callout } from '@cx/ui';
import { Page, DataTable, EmptyState, Spinner } from '@/components/page';
import { useApi } from '@/components/use-api';
import { fetchArtifacts } from '@/lib/api';

type ArtifactsPayload = { artifacts?: { id: string; type: string; path?: string; createdAt?: number; size?: number }[] };

export default function ArtifactsPage() {
  const [filter, setFilter] = useState<string>('');
  const { data, error, loading } = useApi<ArtifactsPayload>(fetchArtifacts);
  const all = data?.artifacts ?? [];
  const filtered = filter ? all.filter((a) => a.type === filter) : all;
  const types = Array.from(new Set(all.map((a) => a.type)));

  return (
    <Page
      eyebrow="work · artifacts"
      title="Artifacts"
      lede="PRDs, ADRs, RFCs, knowledge notes, handoffs — every durable artifact Construct has generated for this project."
      meta={
        <>
          <span className="pill">{all.length} total</span>
          {types.length > 0 && (
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--hairline)', padding: '3px 8px', borderRadius: 6, fontSize: 11.5 }}
            >
              <option value="">all types</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
        </>
      }
    >
      {loading && !data && <Spinner />}
      {error && <EmptyState label="Failed to load" hint={error} />}
      {data && all.length === 0 && <Callout label="None yet"><p>Generate one with <code>construct generate prd …</code>.</p></Callout>}
      {filtered.length > 0 && (
        <Section num="01" title={filter ? `${filter} (${filtered.length})` : 'All artifacts'} defaultOpen>
          <DataTable
            columns={['When', 'Type', 'Path', 'Size']}
            rows={filtered.map((a) => [
              a.createdAt ? new Date(a.createdAt).toLocaleString() : '—',
              <code key="t">{a.type}</code>,
              <code key="p" style={{ fontSize: 11 }}>{a.path ?? '—'}</code>,
              a.size != null ? `${(a.size / 1024).toFixed(1)} KB` : '—',
            ])}
          />
        </Section>
      )}
    </Page>
  );
}
