/** Hooks — registered hooks via /api/status. */
'use client';

import { Section, Callout } from '@cx/ui';
import { Page, DataTable, EmptyState, Spinner } from '@/components/page';
import { useApi } from '@/components/use-api';
import { fetchStatus } from '@/lib/api';

type StatusPayload = { hooks?: { name: string; type?: string; phase?: string; pattern?: string }[] };

export default function HooksPage() {
  const { data, error, loading } = useApi<StatusPayload>(fetchStatus);
  const hooks = data?.hooks ?? [];

  return (
    <Page
      eyebrow="specialists · hooks"
      title="Hooks"
      lede="Real-time hooks fire during agent file edits, tool use, prompt submission, and session end. Each one can block, advise, or stamp metadata."
      meta={<span className="pill">{hooks.length} registered</span>}
    >
      {loading && !data && <Spinner />}
      {error && <EmptyState label="Failed to load" hint={error} />}
      {hooks.length === 0 && data && (
        <Callout label="No hooks reported">
          <p>The runtime didn't surface a hook list in the status payload. Check <code>lib/hooks/</code> directly.</p>
        </Callout>
      )}
      {hooks.length > 0 && (
        <Section num="01" title="Registered" defaultOpen>
          <DataTable
            columns={['Hook', 'Type', 'Phase', 'Pattern']}
            rows={hooks.map((h) => [<code key="n">{h.name}</code>, h.type ?? '—', h.phase ?? '—', <code key="p" style={{ fontSize: 11 }}>{h.pattern ?? '*'}</code>])}
          />
        </Section>
      )}
    </Page>
  );
}
