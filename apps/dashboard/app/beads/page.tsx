/** Beads — embedded issue tracker via /api/beads. */
'use client';

import { Section, Callout } from '@cx/ui';
import { Page, CardGrid, StatCard, DataTable, EmptyState, Spinner, StatusPill } from '@/components/page';
import { useApi } from '@/components/use-api';
import { fetchBeads } from '@/lib/api';

type BeadsPayload = {
  issues?: { id: string; title: string; status: string; priority?: number; type?: string; updated_at?: string }[];
  counts?: {
    total?: number;
    byStatus?: Record<string, number>;
    byPriority?: Record<string, number>;
  };
};

function statusPill(s: string) {
  if (s === 'open' || s === 'ready') return 'ok' as const;
  if (s === 'in_progress' || s === 'review') return 'warn' as const;
  if (s === 'closed' || s === 'done') return 'idle' as const;
  return 'err' as const;
}

export default function BeadsPage() {
  const { data, error, loading } = useApi<BeadsPayload>(fetchBeads);
  const issues = data?.issues ?? [];

  return (
    <Page
      eyebrow="work · beads"
      title="Beads issue tracker"
      lede="Repo-resident SQL issue tracker backed by `bd`. Every plan task, blocker, and closed-with-notes outcome lives here."
      meta={<span className="pill">{data?.counts?.total ?? issues.length} total</span>}
    >
      {loading && !data && <Spinner />}
      {error && <EmptyState label="Failed to load" hint={error} />}
      {data && (
        <>
          <CardGrid>
            <StatCard label="Open" value={data.counts?.byStatus?.open ?? 0} />
            <StatCard label="In progress" value={data.counts?.byStatus?.in_progress ?? 0} />
            <StatCard label="Review" value={data.counts?.byStatus?.review ?? 0} />
            <StatCard label="Closed" value={data.counts?.byStatus?.closed ?? 0} />
          </CardGrid>

          {issues.length === 0 ? (
            <Callout label="No issues"><p>Run <code>bd ready</code> in the project root to file work.</p></Callout>
          ) : (
            <Section num="01" title="All issues" defaultOpen>
              <DataTable
                columns={['ID', 'Title', 'Status', 'Priority', 'Type', 'Updated']}
                rows={issues.map((i) => [
                  <code key="id">{i.id}</code>,
                  i.title,
                  <StatusPill key="s" status={statusPill(i.status)} label={i.status} />,
                  i.priority ?? '—',
                  i.type ?? '—',
                  i.updated_at ? new Date(i.updated_at).toLocaleDateString() : '—',
                ])}
              />
            </Section>
          )}
        </>
      )}
    </Page>
  );
}
