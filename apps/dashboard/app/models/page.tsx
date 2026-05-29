/** Models — provider/tier config via /api/models/* + /api/registry/models. */
'use client';

import { Section, Callout } from '@cx/ui';
import { Page, CardGrid, StatCard, DataTable, EmptyState, Spinner, StatusPill } from '@/components/page';
import { useApi } from '@/components/use-api';
import { fetchModelsProviders, fetchRegistry } from '@/lib/api';

type ProvidersPayload = {
  providers?: Record<string, { id: string; name: string; models?: { id: string; name?: string }[]; health?: string }>;
};

type RegistryPayload = {
  models?: Record<string, { primary?: string | null; fallback?: string[] }>;
};

const TIER_LABELS = ['reasoning', 'standard', 'fast'];

export default function ModelsPage() {
  const providers = useApi<ProvidersPayload>(fetchModelsProviders);
  const registry = useApi<RegistryPayload>(fetchRegistry);

  const providerCount = Object.keys(providers.data?.providers ?? {}).length;
  const modelCount = Object.values(providers.data?.providers ?? {}).reduce((sum, p) => sum + (p.models?.length ?? 0), 0);

  return (
    <Page
      eyebrow="models · configuration"
      title="Models"
      lede="Three-tier execution: reasoning, standard, fast. Each tier resolves to a primary model with ordered fallbacks. Edit assignments inline."
      meta={<span className="pill">{providerCount} providers · {modelCount} models</span>}
    >
      {providers.loading && !providers.data && <Spinner />}
      {providers.error && <EmptyState label="Failed to load providers" hint={providers.error} />}

      {providers.data && registry.data && (
        <>
          <CardGrid>
            {TIER_LABELS.map((tier) => {
              const t = registry.data?.models?.[tier];
              return (
                <StatCard
                  key={tier}
                  label={tier}
                  value={t?.primary ? <code style={{ fontSize: 14 }}>{t.primary.split('/').pop()}</code> : 'unset'}
                  sub={t?.fallback?.length ? `${t.fallback.length} fallbacks` : 'no fallbacks'}
                />
              );
            })}
            <StatCard label="Providers" value={providerCount} sub="registered" />
          </CardGrid>

          <Section num="01" title="Tier assignments" defaultOpen tldr="Each specialist resolves to one of these tiers (or overrides per-specialist).">
            <DataTable
              columns={['Tier', 'Primary', 'Fallbacks']}
              rows={TIER_LABELS.map((tier) => {
                const t = registry.data?.models?.[tier];
                return [
                  <code key="t">{tier}</code>,
                  t?.primary ? <code key="p">{t.primary}</code> : <span style={{ color: 'var(--muted)' }}>unset</span>,
                  <code key="f" style={{ fontSize: 11 }}>{(t?.fallback ?? []).join(' · ') || '—'}</code>,
                ];
              })}
            />
            <p style={{ marginTop: 12 }}><small>Edit assignments via the CLI: <code>construct models set reasoning &lt;model&gt;</code></small></p>
          </Section>

          <Section num="02" title="Providers + health" tldr="Each provider exposes its model catalog and reports a health probe.">
            <DataTable
              columns={['Provider', 'Health', 'Models']}
              rows={Object.values(providers.data.providers ?? {}).map((p) => [
                <code key="i">{p.id}</code>,
                <StatusPill key="h" status={p.health === 'ok' ? 'ok' : p.health === 'degraded' ? 'warn' : p.health === 'down' ? 'err' : 'idle'} label={p.health ?? 'unknown'} />,
                p.models?.length ?? 0,
              ])}
            />
          </Section>

          <Callout label="Configure">
            <p>
              Set provider API keys in <a className="link" href="/providers">Providers</a>.
              Toggle free-only routing via <code>construct models apply-free</code>.
            </p>
          </Callout>
        </>
      )}
    </Page>
  );
}
