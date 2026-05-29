/** Infrastructure — Terraform files via /api/terraform/*. */
'use client';

import { useState } from 'react';
import { Section, Callout, CodeBlock } from '@cx/ui';
import { Page, DataTable, EmptyState, Spinner } from '@/components/page';
import { useApi } from '@/components/use-api';
import { fetchTerraformFiles, apiGet } from '@/lib/api';

type FilesPayload = { files?: { path: string; bytes?: number }[]; terraformDir?: string };

export default function InfrastructurePage() {
  const list = useApi<FilesPayload>(fetchTerraformFiles);
  const [selected, setSelected] = useState<string | null>(null);
  const file = useApi<{ path?: string; content?: string }>(
    () => (selected ? apiGet(`/terraform/file?path=${encodeURIComponent(selected)}`) : Promise.resolve({})),
  );

  return (
    <Page
      eyebrow="system · infrastructure"
      title="Infrastructure"
      lede="Terraform modules that deploy Construct to AWS / GCP / Azure. Browse files inline; run plan/apply/validate/output from the CLI."
      meta={<span className="pill">{list.data?.files?.length ?? 0} files</span>}
    >
      {list.loading && !list.data && <Spinner />}
      {list.error && <EmptyState label="Failed to load" hint={list.error} />}
      {list.data && (
        <>
          <Callout label="Terraform directory">
            <p><code>{list.data.terraformDir ?? '—'}</code></p>
          </Callout>
          <Section num="01" title="Files" defaultOpen>
            <DataTable
              columns={['Path', 'Size', '']}
              rows={(list.data.files ?? []).map((f) => [
                <code key="p" style={{ fontSize: 11 }}>{f.path}</code>,
                f.bytes != null ? `${(f.bytes / 1024).toFixed(1)} KB` : '—',
                <button key="o" className="btn" onClick={() => setSelected(f.path)} type="button">open</button>,
              ])}
            />
          </Section>
          {selected && (
            <Section num="02" title={selected} defaultOpen>
              {file.loading && !file.data?.content && <Spinner />}
              {file.data?.content && <CodeBlock lang="hcl" title={selected}>{file.data.content}</CodeBlock>}
            </Section>
          )}
        </>
      )}
    </Page>
  );
}
