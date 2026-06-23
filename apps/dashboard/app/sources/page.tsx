/** Sources — typed integration targets via /api/sources. */
'use client';

import { Page, CardGrid, StatCard, DataTable, EmptyState, Spinner } from '@/components/page';
import { useApi } from '@/components/use-api';
import { apiGet } from '@/lib/api';

type SourceTarget = {
  id: string;
  provider: string;
  selector: Record<string, string>;
  provenance?: string;
};

type SourcesPayload = {
  path?: string;
  configTargets?: SourceTarget[];
  envTargets?: SourceTarget[];
  effective?: SourceTarget[];
};

export default function SourcesPage() {
  const data = useApi<SourcesPayload>(() => apiGet('/sources'));

  const configTargets = data.data?.configTargets ?? [];
  const envTargets = data.data?.envTargets ?? [];
  const effective = data.data?.effective ?? [];

  return (
    <Page
      eyebrow="integrations · sources"
      title="Source targets"
      lede="Typed GitHub, Jira, Linear, and Slack selectors in construct.config.json. Legacy env lists merge at runtime; embed.yaml remains a complete override when present."
      meta={<span className="pill">{effective.length} effective</span>}
    >
      {data.loading && !data.data && <Spinner />}
      {data.error && <EmptyState label="Failed to load" hint={data.error} />}

      {data.data && (
        <>
          <CardGrid>
            <StatCard label="Config targets" value={configTargets.length} />
            <StatCard label="Env targets" value={envTargets.length} sub="legacy merge" />
            <StatCard label="Effective" value={effective.length} />
          </CardGrid>

          <DataTable
            columns={['ID', 'Provider', 'Selector', 'Provenance']}
            rows={configTargets.map((t) => [
              <code key="id">{t.id}</code>,
              t.provider,
              <code key="sel">{JSON.stringify(t.selector)}</code>,
              t.provenance ?? 'config',
            ])}
          />

          {envTargets.length > 0 && (
            <DataTable
              columns={['ID', 'Provider', 'Selector', 'Provenance']}
              rows={envTargets.map((t) => [
                <code key="id">{t.id}</code>,
                t.provider,
                <code key="sel">{JSON.stringify(t.selector)}</code>,
                t.provenance ?? 'env',
              ])}
            />
          )}
        </>
      )}
    </Page>
  );
}
