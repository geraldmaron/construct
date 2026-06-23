/** Snapshots — last 20 intake snapshots via /api/snapshots. */
'use client';

import { Section, Callout } from '@cx/ui';
import { Page, DataTable, EmptyState, Spinner } from '@/components/page';
import { useApi } from '@/components/use-api';
import { fetchSnapshots, apiGet } from '@/lib/api';

type SnapshotsPayload = { snapshots?: { id: string; kind?: string; ts?: number; summary?: string }[] };

type IntakeMetaPayload = { label?: string; itemNoun?: string };

export default function SnapshotsPage() {
  const { data, error, loading } = useApi<SnapshotsPayload>(fetchSnapshots);
  const meta = useApi<IntakeMetaPayload>(() => apiGet('/intake/list'));
  const snapshots = data?.snapshots ?? [];
  const itemNoun = meta.data?.itemNoun ?? 'signal';
  const nounTitle = itemNoun.charAt(0).toUpperCase() + itemNoun.slice(1);

  return (
    <Page
      eyebrow="activity · snapshots"
      title={`${nounTitle} snapshots`}
      lede={`Recent state captures from the intake watcher. Each snapshot is an append-only record of what the daemon saw for pending ${itemNoun}s.`}
      meta={<span className="pill">{snapshots.length} recent</span>}
    >
      {loading && !data && <Spinner />}
      {error && <EmptyState label="Failed to load" hint={error} />}
      {data && snapshots.length === 0 && <Callout label="No snapshots yet"><p>Drop a file into <code>inbox/</code> to trigger one.</p></Callout>}
      {snapshots.length > 0 && (
        <Section num="01" title="Recent" defaultOpen>
          <DataTable
            columns={['When', 'Kind', 'Summary', 'ID']}
            rows={snapshots.map((s) => [
              s.ts ? new Date(s.ts).toLocaleString() : '—',
              s.kind ?? '—',
              s.summary ?? '—',
              <code key="id">{s.id}</code>,
            ])}
          />
        </Section>
      )}
    </Page>
  );
}
