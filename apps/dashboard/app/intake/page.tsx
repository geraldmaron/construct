/** Intake — pending intake items + config via /api/intake/*. */
'use client';

import { Section, Callout } from '@cx/ui';
import { Page, CardGrid, StatCard, DataTable, EmptyState, Spinner } from '@/components/page';
import { useApi } from '@/components/use-api';
import { fetchIntakeConfig, apiGet } from '@/lib/api';

type IntakeListPayload = {
  items?: { id: string; intakeType?: string; rdStage?: string; primaryOwner?: string; recommendedAction?: string; lane?: string; createdAt?: number }[];
  total?: number;
  label?: string;
  itemNoun?: string;
};

type IntakeConfigPayload = {
  config?: { parentDirs?: string[]; maxDepth?: number; includeProjectInbox?: boolean; includeDocsIntake?: boolean };
  label?: string;
  itemNoun?: string;
};

export default function IntakePage() {
  const items = useApi<IntakeListPayload>(() => apiGet('/intake/list'), 10000);
  const config = useApi<IntakeConfigPayload>(fetchIntakeConfig);
  const pending = items.data?.items ?? [];
  const queueLabel = items.data?.label ?? config.data?.label ?? 'Intake queue';
  const itemNoun = items.data?.itemNoun ?? config.data?.itemNoun ?? 'signal';

  return (
    <Page
      eyebrow="work · intake"
      title={queueLabel}
      lede={`${itemNoun.charAt(0).toUpperCase()}${itemNoun.slice(1)}s dropped into .cx/inbox/ flow through the daemon's deterministic triage (type · stage · owner · chain) and surface here for the agent to action.`}
      meta={<span className="pill">{items.data?.total ?? pending.length} pending</span>}
    >
      {items.loading && !items.data && <Spinner />}
      {items.error && <EmptyState label="Failed to load" hint={items.error} />}

      {items.data && (
        <>
          <CardGrid>
            <StatCard label="Pending" value={items.data.total ?? pending.length} sub="awaiting agent" />
            <StatCard label="Max depth" value={config.data?.config?.maxDepth ?? 3} />
            <StatCard label="Project inbox" value={config.data?.config?.includeProjectInbox ? 'on' : 'off'} />
            <StatCard label="Docs intake" value={config.data?.config?.includeDocsIntake ? 'on' : 'off'} />
          </CardGrid>

          {pending.length === 0 ? (
            <Callout label="No pending packets">
              <p>Drop a file under <code>.cx/inbox/</code> (or a configured parent dir) to create one.</p>
            </Callout>
          ) : (
            <Section num="01" title="Pending packets" defaultOpen tldr="Deterministic triage by the daemon — never an LLM call.">
              <DataTable
                columns={['ID', 'Type', 'Stage', 'Owner', 'Next action', 'Lane', 'When']}
                rows={pending.map((p) => [
                  <code key="i" style={{ fontSize: 11 }}>{p.id}</code>,
                  p.intakeType ?? '—',
                  p.rdStage ?? '—',
                  <code key="o">{p.primaryOwner ?? '—'}</code>,
                  p.recommendedAction ?? '—',
                  p.lane ?? '—',
                  p.createdAt ? new Date(p.createdAt).toLocaleString() : '—',
                ])}
              />
            </Section>
          )}

          <Section num="02" title="Watched directories" tldr="The daemon polls these for new files.">
            <DataTable
              columns={['Path']}
              rows={(config.data?.config?.parentDirs ?? []).map((d) => [<code key="d">{d}</code>])}
            />
          </Section>
        </>
      )}
    </Page>
  );
}
