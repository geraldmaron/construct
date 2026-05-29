/** Skills — registered skill catalog via /api/status (skills field). */
'use client';

import { Section } from '@cx/ui';
import { Page, DataTable, EmptyState, Spinner } from '@/components/page';
import { useApi } from '@/components/use-api';
import { fetchStatus } from '@/lib/api';

type StatusPayload = { skills?: { name: string; description?: string; category?: string }[] };

export default function SkillsPage() {
  const { data, error, loading } = useApi<StatusPayload>(fetchStatus);
  const skills = data?.skills ?? [];

  return (
    <Page
      eyebrow="specialists · skills"
      title="Skills"
      lede="On-demand knowledge bundles a specialist loads via get_skill. Each skill is a markdown file with name + description frontmatter."
      meta={<span className="pill">{skills.length} skills</span>}
    >
      {loading && !data && <Spinner />}
      {error && <EmptyState label="Failed to load" hint={error} />}
      {skills.length > 0 && (
        <Section num="01" title="Catalog" defaultOpen>
          <DataTable
            columns={['Name', 'Category', 'Description']}
            rows={skills.map((s) => [
              <code key="n">{s.name}</code>,
              s.category ?? '—',
              s.description ?? '—',
            ])}
          />
        </Section>
      )}
    </Page>
  );
}
