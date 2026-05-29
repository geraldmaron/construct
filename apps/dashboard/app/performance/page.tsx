/** Performance — per-agent performance reviews via /api/performance/*. */
'use client';

import { Section, Callout } from '@cx/ui';
import { Page, DataTable, EmptyState, Spinner } from '@/components/page';
import { useApi } from '@/components/use-api';
import { apiGet } from '@/lib/api';

type PerfPayload = {
  reviews?: { id: string; agent?: string; ts?: number; rating?: number; notes?: string }[];
  total?: number;
  generatorImplemented?: boolean;
};

export default function PerformancePage() {
  const { data, error, loading } = useApi<PerfPayload>(() => apiGet('/performance/reviews'));
  const reviews = data?.reviews ?? [];

  return (
    <Page
      eyebrow="activity · performance"
      title="Performance reviews"
      lede="Per-agent ratings + qualitative notes from completed sessions. The R&D lead specialist authors these on retrospective."
      meta={<span className="pill">{data?.total ?? reviews.length} reviews</span>}
    >
      {loading && !data && <Spinner />}
      {error && <EmptyState label="Failed to load" hint={error} />}
      {data && !data.generatorImplemented && (
        <Callout label="Generator pending">
          <p>The performance review generator hasn't shipped yet. Existing reviews shown below.</p>
        </Callout>
      )}
      {reviews.length > 0 && (
        <Section num="01" title="Reviews" defaultOpen>
          <DataTable
            columns={['When', 'Agent', 'Rating', 'Notes']}
            rows={reviews.map((r) => [
              r.ts ? new Date(r.ts).toLocaleString() : '—',
              <code key="a">{r.agent ?? '—'}</code>,
              r.rating != null ? `${r.rating}/5` : '—',
              r.notes ?? '—',
            ])}
          />
        </Section>
      )}
    </Page>
  );
}
