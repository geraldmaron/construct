/** Specialists — agent override registry via /api/overrides/agents. */
'use client';

import Link from 'next/link';
import { Section, Callout } from '@cx/ui';
import { Page, DataTable, EmptyState, Spinner, StatusPill } from '@/components/page';
import { useApi } from '@/components/use-api';
import { fetchOverrideList } from '@/lib/api';

type OverrideList = { category?: string; items?: { name: string; hasOverride: boolean; source: string }[] };

export default function AgentsPage() {
  const { data, error, loading } = useApi<OverrideList>(() => fetchOverrideList('agents'));
  const items = data?.items ?? [];

  return (
    <Page
      eyebrow="specialists · registry"
      title="Specialists"
      lede="The 28 cx-specialists shipped with Construct. Override any one by editing its prompt — overrides live alongside originals and are version-tracked."
      meta={<span className="pill">{items.length} agents</span>}
    >
      {loading && !data && <Spinner />}
      {error && <EmptyState label="Failed to load" hint={error} />}
      {data && (
        <>
          <Section num="01" title="Registered specialists" defaultOpen>
            <DataTable
              columns={['Specialist', 'Source', 'Status', '']}
              rows={items.map((it) => [
                <code key="n">{it.name}</code>,
                <code key="s" style={{ fontSize: 11 }}>{it.source}</code>,
                <StatusPill key="st" status={it.hasOverride ? 'warn' : 'ok'} label={it.hasOverride ? 'overridden' : 'default'} />,
                <Link key="l" className="link" href={`/editor?category=agents&name=${encodeURIComponent(it.name)}`}>edit</Link>,
              ])}
            />
          </Section>
          <Callout label="How specialists work">
            <p>
              Each specialist has a prompt, optional skills allowlist, and a model tier (reasoning / standard / fast).
              Read <a className="link" href="/concepts/agents-and-personas" target="_blank">Agents and personas →</a>
            </p>
          </Callout>
        </>
      )}
    </Page>
  );
}
