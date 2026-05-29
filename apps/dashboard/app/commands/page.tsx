/** Slash commands — registered commands via /api/status (commands field). */
'use client';

import { Section } from '@cx/ui';
import { Page, DataTable, EmptyState, Spinner } from '@/components/page';
import { useApi } from '@/components/use-api';
import { fetchStatus } from '@/lib/api';

type StatusPayload = { commands?: { name: string; description?: string }[] };

export default function CommandsPage() {
  const { data, error, loading } = useApi<StatusPayload>(fetchStatus);
  const commands = data?.commands ?? [];

  return (
    <Page
      eyebrow="specialists · slash commands"
      title="Slash commands"
      lede="Registered /commands users can invoke directly from the agent surface. Each one routes to a specialist or scripted action."
      meta={<span className="pill">{commands.length} commands</span>}
    >
      {loading && !data && <Spinner />}
      {error && <EmptyState label="Failed to load" hint={error} />}
      {commands.length > 0 && (
        <Section num="01" title="Catalog" defaultOpen>
          <DataTable
            columns={['Command', 'Description']}
            rows={commands.map((c) => [<code key="c">/{c.name}</code>, c.description ?? '—'])}
          />
        </Section>
      )}
    </Page>
  );
}
