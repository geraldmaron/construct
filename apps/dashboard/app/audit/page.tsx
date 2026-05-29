/** Audit — tamper-evident audit trail via /api/audit. */
'use client';

import { Section, Callout } from '@cx/ui';
import { Page, DataTable, EmptyState, Spinner, CardGrid, StatCard } from '@/components/page';
import { useApi } from '@/components/use-api';
import { apiGet } from '@/lib/api';

type AuditPayload = { entries?: { id?: string; ts?: number; actor?: string; action?: string; subject?: string; hash?: string }[]; total?: number };

export default function AuditPage() {
  const { data, error, loading } = useApi<AuditPayload>(() => apiGet('/audit?limit=200'));
  const entries = data?.entries ?? [];
  const last = entries[0];

  return (
    <Page
      eyebrow="activity · audit"
      title="Audit trail"
      lede="Append-only, chain-hashed record of mutations. Any tamper attempt breaks the chain and surfaces as a Doctor warning."
      meta={<span className="pill">{data?.total ?? entries.length} entries</span>}
    >
      {loading && !data && <Spinner />}
      {error && <EmptyState label="Failed to load" hint={error} />}
      {data && (
        <>
          <CardGrid>
            <StatCard label="Entries" value={data.total ?? entries.length} sub="recorded" />
            <StatCard label="Last actor" value={last?.actor ?? '—'} />
            <StatCard label="Last action" value={last?.action ?? '—'} />
            <StatCard label="Last when" value={last?.ts ? new Date(last.ts).toLocaleTimeString() : '—'} />
          </CardGrid>
          {entries.length === 0 ? (
            <Callout label="Empty"><p>Audit trail hasn't recorded any entries yet.</p></Callout>
          ) : (
            <Section num="01" title="Recent entries" tldr="Newest first. Showing up to 200." defaultOpen>
              <DataTable
                columns={['When', 'Actor', 'Action', 'Subject', 'Hash']}
                rows={entries.map((e) => [
                  e.ts ? new Date(e.ts).toLocaleString() : '—',
                  <code key="a">{e.actor ?? '—'}</code>,
                  e.action ?? '—',
                  e.subject ?? '—',
                  <code key="h" style={{ fontSize: 11 }}>{e.hash?.slice(0, 12) ?? '—'}</code>,
                ])}
              />
            </Section>
          )}
        </>
      )}
    </Page>
  );
}
