/** Doctor — system diagnostics via /api/doctor. Live-refresh every 15s. */
'use client';

import { Section, Callout } from '@cx/ui';
import { Page, StatusPill, DataTable, EmptyState, Spinner, CardGrid, StatCard } from '@/components/page';
import { useApi } from '@/components/use-api';
import { apiGet } from '@/lib/api';

type DoctorPayload = {
  daemon?: { running?: boolean; lastTick?: number; pid?: number };
  audit?: { lines?: number; lastEvent?: string };
  cost?: { todayUsd?: number; weekUsd?: number };
  approvals?: { pending?: number };
  pendingRoleInvocations?: { role: string; reason: string; createdAt?: number }[];
  onboardedPersonas?: string[];
  [k: string]: unknown;
};

export default function DoctorPage() {
  const { data, error, loading, reload } = useApi<DoctorPayload>(() => apiGet('/doctor'), 15000);

  return (
    <Page
      eyebrow="diagnostics · doctor"
      title="Doctor"
      lede="Real-time view of the L0 watcher daemon, audit volume, approval backlog, and cost ledger. Refreshes every 15s."
      meta={
        <>
          <span className="pill">daemon: {data?.daemon?.running ? 'running' : 'stopped'}</span>
          <button className="icon-btn outlined" onClick={reload} style={{ marginLeft: 8 }} type="button">refresh</button>
        </>
      }
    >
      {loading && !data && <Spinner />}
      {error && <EmptyState label="Failed to load /api/doctor" hint={error} />}
      {data && (
        <>
          <CardGrid>
            <StatCard label="Daemon" value={data.daemon?.running ? 'up' : 'down'} sub={data.daemon?.pid ? `pid ${data.daemon.pid}` : '—'} />
            <StatCard label="Approvals" value={data.approvals?.pending ?? 0} sub="pending" />
            <StatCard label="Cost today" value={data.cost?.todayUsd != null ? `$${data.cost.todayUsd.toFixed(2)}` : '—'} sub="usd" />
            <StatCard label="Audit lines" value={data.audit?.lines ?? '—'} sub="recorded" />
          </CardGrid>

          <Section
            num="01"
            title="Pending role invocations"
            time={`${data.pendingRoleInvocations?.length ?? 0} pending`}
            tldr="Specialists the orchestrator has queued for dispatch. Drains as the editor picks them up."
            defaultOpen
          >
            {(data.pendingRoleInvocations ?? []).length === 0 ? (
              <Callout label="All clear"><p>No pending role invocations.</p></Callout>
            ) : (
              <DataTable
                columns={['Role', 'Reason', 'When']}
                rows={data.pendingRoleInvocations!.map((r) => [
                  <code key="r">{r.role}</code>,
                  r.reason,
                  r.createdAt ? new Date(r.createdAt).toLocaleString() : '—',
                ])}
              />
            )}
          </Section>

          <Section
            num="02"
            title="Onboarded personas"
            time={`${data.onboardedPersonas?.length ?? 0} personas`}
            tldr="Personas the runtime has seen at least one session for."
          >
            <DataTable
              columns={['Persona']}
              rows={(data.onboardedPersonas ?? []).map((p) => [<code key="p">{p}</code>])}
            />
          </Section>

          <Section
            num="03"
            title="Audit summary"
            time={data.audit?.lastEvent ?? '—'}
            tldr="The append-only audit trail at ~/.cx/audit-trail.jsonl. Mutations are chain-hashed."
          >
            <p>Total recorded events: <strong>{data.audit?.lines ?? '—'}</strong></p>
            <p>Last event: <code>{data.audit?.lastEvent ?? '—'}</code></p>
          </Section>

          <Section
            num="04"
            title="Cost ledger"
            tldr="LLM spend per session. The Stop hook updates this on session end."
          >
            <p>Today: <strong>${(data.cost?.todayUsd ?? 0).toFixed(2)}</strong></p>
            <p>Last 7 days: <strong>${(data.cost?.weekUsd ?? 0).toFixed(2)}</strong></p>
          </Section>
        </>
      )}
    </Page>
  );
}
