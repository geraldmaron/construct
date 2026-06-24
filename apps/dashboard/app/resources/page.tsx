/** Resources — services status (Docker, Postgres, embed daemon) via /api/status. */
'use client';

import { Section, Callout } from '@cx/ui';
import { Page, CardGrid, StatCard, DataTable, EmptyState, Spinner, StatusPill } from '@/components/page';
import { useApi } from '@/components/use-api';
import { fetchStatus, fetchEmbedStatus } from '@/lib/api';

type StatusPayload = {
  services?: Record<string, { status: string; url?: string; pid?: number }>;
  mode?: string;
};
type EmbedPayload = { running?: boolean; lastTickAt?: number; backend?: string };

export default function ResourcesPage() {
  const s = useApi<StatusPayload>(fetchStatus, 10000);
  const e = useApi<EmbedPayload>(fetchEmbedStatus, 10000);

  const services = s.data?.services ?? {};
  const total = Object.keys(services).length;
  const ok = Object.values(services).filter((x) => x.status === 'ok' || x.status === 'running').length;

  return (
    <Page
      eyebrow="overview · services"
      title="Services"
      lede="Every local process that the runtime supervises. Dashboard, Postgres, memory bridge, OpenCode bridge, embed daemon."
      meta={
        <>
          <span className="pill">{ok}/{total} healthy</span>
          <span className="pill">embed: {e.data?.running ? 'running' : 'stopped'}</span>
        </>
      }
    >
      {s.loading && !s.data && <Spinner />}
      {s.error && <EmptyState label="Failed to load /api/status" hint={s.error} />}
      {s.data && (
        <>
          <CardGrid>
            <StatCard label="Total" value={total} />
            <StatCard label="Healthy" value={ok} />
            <StatCard label="Degraded" value={Object.values(services).filter((x) => x.status === 'degraded').length} />
            <StatCard label="Down" value={Object.values(services).filter((x) => !['ok', 'running', 'degraded'].includes(x.status)).length} />
          </CardGrid>

          <Section num="01" title="Service inventory" defaultOpen>
            <DataTable
              columns={['Service', 'Status', 'URL', 'PID']}
              rows={Object.entries(services).map(([name, info]) => [
                <code key="n">{name}</code>,
                <StatusPill key="s" status={info.status === 'ok' || info.status === 'running' ? 'ok' : info.status === 'degraded' ? 'warn' : 'err'} label={info.status} />,
                info.url ? <a key="u" className="link" href={info.url} target="_blank" rel="noreferrer">{info.url}</a> : '—',
                info.pid ?? '—',
              ])}
            />
          </Section>

          {e.data && (
            <Section num="02" title="Embed daemon" tldr="Watches inbox/, ingests files, runs deterministic triage. Optional — auto-started by `construct dev` when embed.yaml is present.">
              <p>Running: <StatusPill status={e.data.running ? 'ok' : 'idle'} label={e.data.running ? 'yes' : 'no'} /></p>
              {e.data.lastTickAt && <p>Last tick: {new Date(e.data.lastTickAt).toLocaleString()}</p>}
              {e.data.backend && <p>Backend: <code>{e.data.backend}</code></p>}
            </Section>
          )}

          <Callout label="Manage services">
            <p>Restart from the CLI: <code>construct dev</code> brings everything up; <code>construct stop</code> tears down; <code>construct status</code> prints the same picture as this page.</p>
          </Callout>
        </>
      )}
    </Page>
  );
}
