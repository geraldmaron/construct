/** Skills — registered skill catalog and artifact manifest metadata via /api/status. */
'use client';

import { Section } from '@cx/ui';
import { Page, DataTable, EmptyState, Spinner } from '@/components/page';
import { useApi } from '@/components/use-api';
import { fetchStatus } from '@/lib/api';

type ArtifactMeta = {
  type: string;
  tone?: string;
  primaryOwners?: string[];
  workflowSkill?: string | null;
  releaseGate?: { requiredReviewers?: string[]; optionalReviewers?: string[] };
};

type StatusPayload = {
  skills?: { category: string; files: string[] }[];
  artifactManifest?: Record<string, ArtifactMeta>;
};

export default function SkillsPage() {
  const { data, error, loading } = useApi<StatusPayload>(fetchStatus);
  const skills = data?.skills ?? [];
  const manifest = data?.artifactManifest ?? {};
  const manifestRows = Object.entries(manifest);

  const skillCount = skills.reduce((n, cat) => n + cat.files.length, 0);

  return (
    <Page
      eyebrow="specialists · skills"
      title="Skills"
      lede="On-demand knowledge bundles a specialist loads via get_skill. Artifact manifest metadata defines tone, owners, and release gates per doc type."
      meta={<span className="pill">{skillCount} skills · {manifestRows.length} artifact types</span>}
    >
      {loading && !data && <Spinner />}
      {error && <EmptyState label="Failed to load" hint={error} />}
      {manifestRows.length > 0 && (
        <Section num="01" title="Artifact manifest" defaultOpen>
          <DataTable
            columns={['Type', 'Tone', 'Owners', 'Workflow skill', 'Required reviewers']}
            rows={manifestRows.map(([type, meta]) => [
              <code key="t">{type}</code>,
              meta.tone ?? '—',
              (meta.primaryOwners ?? []).join(', ') || '—',
              meta.workflowSkill ?? '—',
              (meta.releaseGate?.requiredReviewers ?? []).join(', ') || '—',
            ])}
          />
        </Section>
      )}
      {skills.length > 0 && (
        <Section num="02" title="Skill catalog" defaultOpen>
          <DataTable
            columns={['Category', 'Skills']}
            rows={skills.map((s) => [
              s.category,
              s.files.map((f) => `${s.category}/${f}`).join(', '),
            ])}
          />
        </Section>
      )}
    </Page>
  );
}
