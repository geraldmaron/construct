/** Providers — credential + billing config via /api/providers/*. */
'use client';

import { Section, Callout } from '@cx/ui';
import { Page, CardGrid, StatCard, DataTable, EmptyState, Spinner, StatusPill } from '@/components/page';
import { useApi } from '@/components/use-api';
import {
  fetchProviders, fetchProviderCredentials, fetchProviderBilling, fetchOpStatus,
} from '@/lib/api';

type ProvidersPayload = {
  summary?: { id: string; displayName: string; health: string; status?: string }[];
};
type CredentialsPayload = {
  credentials?: { provider: string; vars: { envVar: string; set: boolean; preview?: string }[] }[];
};
type BillingPayload = {
  global?: { mode?: string };
  providers?: Record<string, { mode?: string }>;
};

export default function ProvidersPage() {
  const providers = useApi<ProvidersPayload>(() => fetchProviders(true));
  const creds = useApi<CredentialsPayload>(fetchProviderCredentials);
  const billing = useApi<BillingPayload>(fetchProviderBilling);
  const op = useApi(fetchOpStatus);

  const list = providers.data?.summary ?? [];
  const credList = creds.data?.credentials ?? [];
  const opData = op.data as { available?: boolean; signedIn?: boolean } | null;

  return (
    <Page
      eyebrow="models · providers"
      title="Providers"
      lede="LLM and integration providers Construct can talk to. Set credentials, billing posture, and (optionally) pull secrets from 1Password."
      meta={
        <>
          <span className="pill">{list.length} providers</span>
          {opData?.available && (
            <StatusPill status={opData.signedIn ? 'ok' : 'warn'} label={opData.signedIn ? '1Password signed in' : '1Password available'} />
          )}
        </>
      }
    >
      {providers.error && <EmptyState label="Failed to load" hint={providers.error} />}
      {providers.loading && !providers.data && <Spinner />}
      {providers.data && (
        <>
          <CardGrid>
            <StatCard label="Providers" value={list.length} />
            <StatCard label="Healthy" value={list.filter((p) => p.health === 'ok').length} />
            <StatCard label="Degraded" value={list.filter((p) => p.health === 'degraded').length} />
            <StatCard label="Down" value={list.filter((p) => p.health === 'down').length} />
          </CardGrid>

          <Section num="01" title="Provider health" defaultOpen tldr="Probed every page load. Failures mean credentials missing or the provider rejected the test call.">
            <DataTable
              columns={['Provider', 'Status', 'Display name']}
              rows={list.map((p) => [
                <code key="i">{p.id}</code>,
                <StatusPill key="s" status={p.health === 'ok' ? 'ok' : p.health === 'degraded' ? 'warn' : p.health === 'down' ? 'err' : 'idle'} label={p.health} />,
                p.displayName,
              ])}
            />
          </Section>

          <Section num="02" title="Credentials" tldr="Env vars per provider. Set via construct CLI, the dashboard form, or 1Password reference.">
            {creds.loading && !creds.data && <Spinner />}
            {credList.length > 0 && (
              <DataTable
                columns={['Provider', 'Var', 'Status', 'Preview']}
                rows={credList.flatMap((p) =>
                  p.vars.map((v) => [
                    <code key="p">{p.provider}</code>,
                    <code key="v" style={{ fontSize: 11 }}>{v.envVar}</code>,
                    <StatusPill key="s" status={v.set ? 'ok' : 'idle'} label={v.set ? 'set' : 'unset'} />,
                    v.preview ? <code key="pr" style={{ fontSize: 11 }}>{v.preview}</code> : '—',
                  ])
                )}
              />
            )}
          </Section>

          <Section num="03" title="Billing" tldr="Per-provider billing mode (metered vs subscription).">
            {billing.data && (
              <DataTable
                columns={['Provider', 'Mode']}
                rows={[
                  ['(global)', billing.data.global?.mode ?? 'metered'],
                  ...Object.entries(billing.data.providers ?? {}).map(([p, info]) => [<code key="p">{p}</code>, info.mode ?? 'metered']),
                ]}
              />
            )}
          </Section>

          <Callout label="Add a custom provider">
            <p>The CLI exposes <code>construct provider add &lt;name&gt;</code> for new integrations. Custom LLM providers go through the engine plugin interface.</p>
          </Callout>
        </>
      )}
    </Page>
  );
}
