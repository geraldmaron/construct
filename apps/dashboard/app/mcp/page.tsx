/** MCP — registered MCP servers via /api/registry. */
'use client';

import { Section } from '@cx/ui';
import { Page, DataTable, EmptyState, Spinner } from '@/components/page';
import { useApi } from '@/components/use-api';
import { fetchRegistry } from '@/lib/api';

type RegistryPayload = {
  mcpServers?: Record<string, { command?: string; args?: string[]; type?: string; url?: string; env?: Record<string, string> }>;
};

export default function McpPage() {
  const { data, error, loading } = useApi<RegistryPayload>(fetchRegistry);
  const servers = data?.mcpServers ?? {};

  return (
    <Page
      eyebrow="models · MCP"
      title="MCP servers"
      lede="Tools available to Construct via the Model Context Protocol. The dashboard, every editor (Claude, OpenCode, Codex), and external tools all connect through this registry."
      meta={<span className="pill">{Object.keys(servers).length} registered</span>}
    >
      {loading && !data && <Spinner />}
      {error && <EmptyState label="Failed to load" hint={error} />}
      {Object.keys(servers).length > 0 && (
        <Section num="01" title="Servers" defaultOpen>
          <DataTable
            columns={['ID', 'Transport', 'Endpoint']}
            rows={Object.entries(servers).map(([id, info]) => [
              <code key="id">{id}</code>,
              info.type ?? (info.command ? 'stdio' : '—'),
              <code key="e" style={{ fontSize: 11 }}>{info.url ?? (info.command ? [info.command, ...(info.args ?? [])].join(' ') : '—')}</code>,
            ])}
          />
        </Section>
      )}
    </Page>
  );
}
