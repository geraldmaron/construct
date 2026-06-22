/** Certification — capability freshness grid via /api/certification/status. */
'use client';

import { Section } from '@cx/ui';
import { Page, DataTable, EmptyState, Spinner, StatusPill } from '@/components/page';
import { useApi } from '@/components/use-api';
import { apiGet } from '@/lib/api';

type CapabilityRow = {
  id: string;
  criticality?: string | null;
  status: string;
  lastRunAt?: string | null;
  lastScenarioId?: string | null;
};

type StaleRow = {
  capabilityId: string;
  staleSince?: string | null;
  staleReason?: string | null;
  stalePaths?: string[];
};

type RunRow = {
  id: string;
  scenarioId: string;
  capabilityId: string;
  status: string;
  createdAt?: string | null;
  artifactPath: string;
};

type CertificationPayload = {
  generatedAt?: string;
  capabilities?: CapabilityRow[];
  stale?: StaleRow[];
  runs?: RunRow[];
  runsDir?: string;
};

function statusPill(status: string) {
  if (status === 'pass') return <StatusPill status="ok" label="pass" />;
  if (status === 'stale') return <StatusPill status="warn" label="stale" />;
  if (status === 'fail') return <StatusPill status="err" label="fail" />;
  if (status === 'inconclusive') return <StatusPill status="warn" label="inconclusive" />;
  return <StatusPill status="idle" label={status || 'never-run'} />;
}

export default function CertificationPage() {
  const { data, error, loading, reload } = useApi<CertificationPayload>(
    () => apiGet('/certification/status'),
    30000,
  );

  const capabilities = data?.capabilities ?? [];
  const stale = data?.stale ?? [];
  const runs = (data?.runs ?? []).slice(0, 20);

  return (
    <Page
      eyebrow="governance · certification"
      title="Certification"
      lede="Capability grid, stale reasons, and recent run artifacts. Mirrors construct certify status without secrets."
      meta={
        <>
          <span className="pill">generated: {data?.generatedAt ?? '—'}</span>
          <button className="icon-btn outlined" onClick={reload} style={{ marginLeft: 8 }} type="button">
            refresh
          </button>
        </>
      }
    >
      {loading && !data && <Spinner />}
      {error && <EmptyState label="Failed to load /api/certification/status" hint={error} />}
      {data && (
        <>
          <Section
            num="01"
            title="Capability grid"
            time={`${capabilities.length} capabilities`}
            tldr="Release and important capabilities with last run verdict and stale markers."
            defaultOpen
          >
            <DataTable
              columns={['Capability', 'Criticality', 'Status', 'Last scenario', 'Last run']}
              rows={capabilities.map((cap) => [
                <code key="id">{cap.id}</code>,
                cap.criticality ?? '—',
                statusPill(cap.status),
                cap.lastScenarioId ? <code key="sc">{cap.lastScenarioId}</code> : '—',
                cap.lastRunAt ? new Date(cap.lastRunAt).toLocaleString() : '—',
              ])}
            />
          </Section>

          <Section
            num="02"
            title="Stale evidence"
            time={`${stale.length} stale`}
            tldr="Capabilities whose certification evidence is outdated after ledger changePaths touched."
          >
            {stale.length === 0 ? (
              <p>No stale capabilities.</p>
            ) : (
              <DataTable
                columns={['Capability', 'Since', 'Reason', 'Paths']}
                rows={stale.map((row) => [
                  <code key="id">{row.capabilityId}</code>,
                  row.staleSince ? new Date(row.staleSince).toLocaleString() : '—',
                  row.staleReason ?? '—',
                  (row.stalePaths ?? []).join(', ') || '—',
                ])}
              />
            )}
          </Section>

          <Section
            num="03"
            title="Recent runs"
            time={`${runs.length} shown`}
            tldr={`Durable artifacts under ${data.runsDir ?? '.cx/certification/runs/'}.`}
          >
            {runs.length === 0 ? (
              <p>No certification runs recorded yet. Run <code>construct certify run &lt;scenario-id&gt;</code>.</p>
            ) : (
              <DataTable
                columns={['Run id', 'Scenario', 'Capability', 'Verdict', 'Artifact', 'When']}
                rows={runs.map((run) => [
                  <code key="id">{run.id}</code>,
                  <code key="sc">{run.scenarioId}</code>,
                  <code key="cap">{run.capabilityId}</code>,
                  statusPill(run.status),
                  <code key="path">{run.artifactPath}</code>,
                  run.createdAt ? new Date(run.createdAt).toLocaleString() : '—',
                ])}
              />
            )}
          </Section>
        </>
      )}
    </Page>
  );
}
