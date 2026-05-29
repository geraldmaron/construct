/** Workflow — plan.md + task graph via /api/workflow. */
'use client';

import { Section, Callout } from '@cx/ui';
import { Page, DataTable, EmptyState, Spinner, CardGrid, StatCard, StatusPill } from '@/components/page';
import { useApi } from '@/components/use-api';
import { apiGet } from '@/lib/api';

type WorkflowPayload = {
  hasPlan?: boolean;
  planSummary?: string;
  tasks?: { id: string; title: string; status: string; phase?: string }[];
  phases?: string[];
  status?: string;
  taskStatusCounts?: Record<string, number>;
};

function statusKind(s: string): 'ok' | 'warn' | 'err' | 'idle' {
  if (s === 'done' || s === 'completed') return 'ok';
  if (s === 'in_progress') return 'warn';
  if (s === 'blocked' || s === 'failed') return 'err';
  return 'idle';
}

export default function WorkflowPage() {
  const { data, error, loading } = useApi<WorkflowPayload>(() => apiGet('/workflow'));
  const tasks = data?.tasks ?? [];
  const counts = data?.taskStatusCounts ?? {};

  return (
    <Page
      eyebrow="work · workflow"
      title="Workflow"
      lede="The current live working plan from plan.md, plus the task graph derived from intake. Beads is the durable backlog; this is the active picture."
      meta={<span className="pill">{tasks.length} tasks · {data?.status ?? 'unknown'}</span>}
    >
      {loading && !data && <Spinner />}
      {error && <EmptyState label="Failed to load" hint={error} />}
      {data && (
        <>
          <CardGrid>
            <StatCard label="Total" value={tasks.length} />
            <StatCard label="In progress" value={counts.in_progress ?? 0} />
            <StatCard label="Done" value={counts.done ?? 0} />
            <StatCard label="Blocked" value={counts.blocked ?? 0} />
          </CardGrid>
          {data.planSummary && (
            <Callout label="Plan summary">
              <p style={{ whiteSpace: 'pre-wrap' }}>{data.planSummary}</p>
            </Callout>
          )}
          <Section num="01" title="Tasks" defaultOpen>
            {tasks.length === 0 ? (
              <EmptyState label="No tasks" hint="Run `construct workflow init` to start one." />
            ) : (
              <DataTable
                columns={['ID', 'Title', 'Phase', 'Status']}
                rows={tasks.map((t) => [
                  <code key="id">{t.id}</code>,
                  t.title,
                  t.phase ?? '—',
                  <StatusPill key="s" status={statusKind(t.status)} label={t.status} />,
                ])}
              />
            )}
          </Section>
        </>
      )}
    </Page>
  );
}
