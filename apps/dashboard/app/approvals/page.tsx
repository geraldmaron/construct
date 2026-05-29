/** Approvals — pending approval queue via /api/approvals. */
'use client';

import { Section, Callout } from '@cx/ui';
import { Page, DataTable, EmptyState, Spinner } from '@/components/page';
import { useApi } from '@/components/use-api';
import { fetchApprovals } from '@/lib/api';

type ApprovalsPayload = { items?: { id: string; kind?: string; summary?: string; ts?: number; risk?: string }[] };

export default function ApprovalsPage() {
  const { data, error, loading } = useApi<ApprovalsPayload>(fetchApprovals, 10000);
  const items = data?.items ?? [];

  return (
    <Page
      eyebrow="work · approvals"
      title="Approval queue"
      lede="High-risk mutations (work item creation, merge, doc publish, config changes) are gated here. Low-risk work (reading, analysis, drafts) is autonomous."
      meta={<span className="pill">{items.length} pending</span>}
    >
      {loading && !data && <Spinner />}
      {error && <EmptyState label="Failed to load" hint={error} />}
      {data && items.length === 0 && (
        <Callout label="All clear"><p>No approvals pending. Items queue here from specialists when they hit a high-risk mutation gate.</p></Callout>
      )}
      {items.length > 0 && (
        <Section num="01" title="Pending items" tldr="Newest first. Click into the source artifact for full context." defaultOpen>
          <DataTable
            columns={['When', 'Kind', 'Risk', 'Summary', 'ID']}
            rows={items.map((a) => [
              a.ts ? new Date(a.ts).toLocaleString() : '—',
              a.kind ?? '—',
              a.risk ?? '—',
              a.summary ?? '—',
              <code key="id">{a.id}</code>,
            ])}
          />
        </Section>
      )}
    </Page>
  );
}
