/**
 * Resources.tsx — Mission Control v3.
 *
 * Information hierarchy: hero row (system health · today's spend ·
 * open beads as oversized numbers), trends row (7-day cost bar chart
 * + service health strip), then secondary cards (resources / handoffs
 * / vector / providers / langfuse / intake). Replaces the flat
 * 6-up grid that read as "just data" with no priority.
 *
 * Every card carries a typed state with a CTA on degraded paths.
 * Auto-refreshes every 10s.
 */
import { useEffect, useState } from 'react';
import { fetchAuthStatus, fetchStatus, fetchInsights, fetchRegistry } from '../lib/api';

interface StatusData {
  version?: string;
  lastSync?: string;
  system?: {
    overall?: { status?: string; summary?: string };
    services?: Array<{ name: string; status: string; message?: string; url?: string; runtime?: string; note?: string }>;
  };
  features?: Array<{ name: string; description: string; status: string }>;
  auth?: { mode?: string; providers?: string[]; tokenConfigured?: boolean };
}

function Hint({ children, text }: { children: React.ReactNode; text: string }) {
  return (
    <span
      title={text}
      className="cursor-help inline-flex items-center gap-1 underline decoration-dotted decoration-text-dim underline-offset-2"
      aria-label={text}
    >
      {children}
    </span>
  );
}

function pipClass(status: string | undefined): string {
  switch (status) {
    case 'healthy': case 'ok': case 'configured':
      return 'pip pip-healthy';
    case 'degraded': case 'warning':
      return 'pip pip-degraded';
    case 'down': case 'unavailable': case 'error': case 'not-configured':
      return 'pip pip-down';
    default:
      return 'pip';
  }
}

function statusIcon(status: string | undefined): string {
  switch (status) {
    case 'healthy': case 'ok': case 'configured': return '✓';
    case 'degraded': case 'warning': return '!';
    case 'down': case 'unavailable': case 'error': case 'not-configured': return '✕';
    default: return '·';
  }
}

function CostTrendChart({ trend }: { trend: any }) {
  if (!trend || trend.state !== 'ok' || !trend.series?.length) {
    return (
      <p className="text-xs text-text-dim">
        {trend?.state === 'misconfigured'
          ? trend.message
          : trend?.state === 'empty'
            ? 'No Langfuse traces in the last 7 days.'
            : 'Cost trend unavailable.'}
      </p>
    );
  }
  const max = Math.max(...trend.series.map((s: any) => s.costUsd), 0.0001);
  const bars = trend.series;
  return (
    <div>
      <div className="flex items-end gap-1.5 h-32">
        {bars.map((b: any) => {
          const h = max > 0 ? (b.costUsd / max) * 100 : 0;
          return (
            <div key={b.day} className="flex-1 flex flex-col items-center justify-end h-full" title={`${b.day}: $${b.costUsd.toFixed(4)} · ${b.traces} traces${b.errors ? ` · ${b.errors} errors` : ''}`}>
              <div
                style={{
                  width: '100%',
                  height: `${Math.max(2, h)}%`,
                  background: b.errors > 0 ? 'var(--status-degraded)' : 'var(--aurora-gradient)',
                  borderRadius: '4px 4px 0 0',
                  opacity: b.traces === 0 ? 0.25 : 1,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-text-dim mt-2 font-mono">
        {bars.map((b: any) => (
          <span key={b.day} className="flex-1 text-center">{b.day.slice(-5)}</span>
        ))}
      </div>
    </div>
  );
}

function ProgressBar({ ratio, dangerOver = 1, warnOver = 0.8 }: { ratio: number; dangerOver?: number; warnOver?: number }) {
  const r = Math.max(0, Math.min(2, ratio));
  return (
    <div className="h-1.5 w-full bg-bg-muted rounded mt-2">
      <div
        className="h-full rounded transition-all"
        style={{
          width: `${Math.min(100, r * 100)}%`,
          background: r > dangerOver ? 'var(--status-down)' : r > warnOver ? 'var(--status-degraded)' : 'var(--aurora-gradient)',
        }}
      />
    </div>
  );
}

export default function Resources() {
  const [data, setData] = useState<StatusData | null>(null);
  const [auth, setAuth] = useState<any>(null);
  const [insights, setInsights] = useState<any>(null);
  const [registry, setRegistry] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      Promise.all([
        fetchStatus().then(setData).catch(() => {}),
        fetchAuthStatus().then(setAuth).catch(() => {}),
        fetchInsights().then(setInsights).catch(() => {}),
        fetchRegistry().then(setRegistry).catch(() => {}),
      ])
        .catch((e) => setError(e?.message || 'Failed to fetch status'))
        .finally(() => setLoading(false));
    load();
    const id = window.setInterval(load, 10000);
    // Force a fresh poll whenever the tab returns to the foreground. macOS
    // throttles setInterval to ~1s for backgrounded tabs but stops it entirely
    // when minimized; without this, returning to the tab can show data from
    // many minutes ago until the next interval tick.
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  if (loading) return <p className="text-text-dim text-sm">Loading system snapshot…</p>;
  if (error) {
    return (
      <section className="card max-w-2xl">
        <h1 className="text-lg font-semibold mb-2">Mission Control unavailable</h1>
        <p className="text-text-muted text-sm mb-4">{error}</p>
        <p className="text-text-dim text-xs">
          Try <code className="px-1 py-0.5 bg-bg-muted rounded">construct doctor</code> to identify the cause.
        </p>
      </section>
    );
  }
  if (!data) return null;

  const overall = (data.system?.overall?.status as string) || 'unknown';
  const openBeads = insights?.beads?.byStatus?.open || 0;
  const inProgressBeads = insights?.beads?.byStatus?.in_progress || 0;
  // Two numbers per the per-provider billing-mode design:
  //   meteredActualUsd  — sums only metered/mixed providers (real $ leaving your account today)
  //   meteredEquivalentUsd — sums everything (what it WOULD cost if every call were metered)
  // The card leads with actual; equivalent is a footnote. Subscription-only setups
  // see "$0.00 actual" + an explainer instead of a misleading huge equivalent number.
  const todayActual = insights?.cost?.budget?.todayActualUsd ?? insights?.cost?.budget?.todayUsd ?? 0;
  const todayEquiv = insights?.cost?.budget?.todayMeteredEquivalentUsd ?? insights?.cost?.budget?.todayUsd ?? 0;
  const todayCap = insights?.cost?.budget?.capUsd ?? 0;
  const costRatio = insights?.cost?.budget?.usageRatio ?? 0;
  const billingMode = insights?.cost?.billingMode || 'subscription';
  const billingSource = insights?.cost?.billingSource || 'inferred';
  const providerBilling = insights?.cost?.providerBilling || {};
  const hasProviderOverrides = Object.keys(providerBilling).length > 0;
  const everythingSubscription = !hasProviderOverrides
    ? billingMode === 'subscription'
    : Object.values(providerBilling).every((p: any) => p?.billingMode === 'subscription');
  const isMixed = billingMode === 'mixed' || (hasProviderOverrides && !everythingSubscription);
  const isInferred = billingSource === 'inferred';
  const costLabel = everythingSubscription
    ? "Today's actual spend"
    : isMixed
      ? "Today's actual spend (mixed billing)"
      : "Today's actual spend";
  const costHelp = everythingSubscription
    ? "You're on subscription billing across all providers, so actual spend today is $0. The metered-equivalent below shows what these calls WOULD cost on pay-per-token APIs — useful for capacity planning but not a real charge against your account."
    : isMixed
      ? 'Mixed billing: subscription providers contribute $0 to actual spend; metered providers are summed here. Configure per-provider modes on the Providers page.'
      : "Total USD spent on metered LLM provider calls today (UTC midnight to now), summed across every persona. Pulled from the local cost ledger at ~/.cx/session-cost.jsonl. 'Enforce on' means calls past the cap are refused; 'enforce off' is advisory only.";
  const diskRatio = insights?.resources?.totalCxUsageRatio ?? 0;
  const diskMb = (insights?.resources?.totalCxBytes ?? 0) / 1024 / 1024;
  const diskCapMb = (insights?.resources?.totalCxCap ?? 0) / 1024 / 1024;
  const services = data.system?.services ?? [];
  const healthyCount = services.filter((s) => s.status === 'healthy').length;

  // Onboarding gates — first-run guard rail. Reads the same registry the
  // Models page edits, so there's no parallel "first-run path" diverging
  // from the real surface. Auto-hides when every gate passes.
  const tierPrimaries = ['reasoning', 'standard', 'fast']
    .map((t) => registry?.models?.[t]?.primary)
    .filter((v) => typeof v === 'string' && v.length > 0);

  const gates = [
    {
      key: 'model',
      label: `Pick a model per tier (${tierPrimaries.length} of 3 set)`,
      done: tierPrimaries.length === 3,
      href: '#/models',
      hint: 'Construct ships with no default — choose reasoning / standard / fast. Auto-pick from free OpenRouter models is one click away.',
    },
    {
      key: 'provider',
      label: 'Configure at least one provider',
      done: (insights?.providers ?? []).some((p: any) => p.state === 'configured'),
      href: '#/providers',
      hint: 'Set an API key (Anthropic / OpenAI / OpenRouter / Ollama) so the picked models can run.',
    },
  ];
  const gatesRemaining = gates.filter((g) => !g.done);

  return (
    <div className="max-w-7xl space-y-6">
      <header>
        <p className="text-text-dim text-xs uppercase tracking-wider mb-1">Page</p>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Mission Control</h1>
        <p className="text-text-muted text-sm mt-1">
          Live system snapshot · refreshes every 10s · {data.version ?? '—'}
          {data.lastSync && <> · last sync {new Date(data.lastSync).toLocaleTimeString()}</>}
        </p>
      </header>

      {gatesRemaining.length > 0 && (
        <section className="card border border-amber-300 bg-amber-50/40" aria-labelledby="getting-started-heading">
          <h2 id="getting-started-heading" className="text-xs uppercase tracking-wider text-text-dim mb-3">
            Getting started — {gates.filter((g) => g.done).length} of {gates.length} complete
          </h2>
          <ul className="space-y-2">
            {gates.map((g) => (
              <li key={g.key} className="flex items-start gap-3 text-sm">
                <span aria-hidden="true" className={g.done ? 'text-green-700' : 'text-amber-700'}>
                  {g.done ? '✓' : '○'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className={g.done ? 'line-through text-text-dim' : 'font-medium'}>{g.label}</span>
                    {!g.done && (
                      <a href={g.href} className="text-xs underline hover:no-underline text-indigo-700">
                        Fix here →
                      </a>
                    )}
                  </div>
                  <p className="text-xs text-text-dim">{g.hint}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* HERO row — large numbers, three primary signals */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-labelledby="hero-heading">
        <h2 id="hero-heading" className="sr-only">Primary signals</h2>

        <article className="card">
          <p className="text-xs uppercase tracking-wider text-text-dim mb-3">
            <Hint text="Count of running local services (Dashboard, Langfuse, Memory, OpenCode) that are responding to health probes.">
              System health
            </Hint>
          </p>
          <div className="flex items-baseline gap-3">
            <span className={pipClass(overall)} style={{ fontSize: '0.9rem' }}>
              <span aria-hidden="true">{statusIcon(overall)}</span>
              {overall}
            </span>
          </div>
          <p className="text-3xl font-semibold mt-3">{healthyCount}<span className="text-base text-text-dim font-normal">/{services.length}</span></p>
          <p className="text-xs text-text-muted mt-1">core surfaces reachable</p>
          {data.system?.overall?.summary && (
            <p className="text-xs text-text-dim mt-2">{data.system.overall.summary}</p>
          )}
        </article>

        <article className="card">
          <p className="text-xs uppercase tracking-wider text-text-dim mb-3">
            <Hint text={costHelp}>{costLabel}</Hint>
            {everythingSubscription && (
              <span
                className="ml-2 pip pip-healthy text-[10px]"
                title={hasProviderOverrides
                  ? 'All providers configured as subscription on the Providers page. Today\'s actual spend is $0 — flat-rate plan covers it.'
                  : 'Subscription billing (global). Today\'s actual spend is $0; metered-equivalent shown as a footnote.'}
              >
                <span aria-hidden="true">✓</span>
                subscription{isInferred && !hasProviderOverrides ? ' (auto)' : ''}
              </span>
            )}
            {!everythingSubscription && isMixed && (
              <span className="ml-2 pip text-[10px]" title="Per-provider modes — some metered, some subscription. Configure on the Providers page.">
                <span aria-hidden="true">i</span>
                mixed
              </span>
            )}
          </p>
          {isInferred && !hasProviderOverrides && (
            <p className="text-[11px] mb-2" style={{ color: 'var(--status-degraded)' }}>
              ⚠ Billing mode auto-detected. <a href="#/providers" className="underline hover:opacity-80">Set per provider →</a>
            </p>
          )}
          <p className="text-3xl font-semibold">${todayActual.toFixed(4)}</p>
          <p className="text-xs text-text-muted mt-1">
            {everythingSubscription ? (
              <>covered by subscription · no pay-per-token charges today</>
            ) : (
              <>/ ${todayCap.toFixed(2)} cap · enforce {insights?.cost?.budget?.enforce ? 'on' : 'off'}</>
            )}
          </p>
          {todayEquiv > todayActual + 0.01 && (
            <p className="text-[10px] text-text-dim mt-2 font-mono">
              metered-equiv if all calls were pay-per-token: ≈ ${todayEquiv.toFixed(2)}
              {hasProviderOverrides && <> · subscription providers excluded from headline</>}
            </p>
          )}
          {!everythingSubscription && <ProgressBar ratio={costRatio} />}
          <p className="text-xs text-text-dim mt-2">
            7d actual: ${(insights?.cost?.windows?.last7d?.meteredActualUsd ?? insights?.cost?.windows?.last7d?.totalCostUsd ?? 0).toFixed(2)} ·{' '}
            <Hint text="Share of input tokens served from prompt cache instead of paid full-price input. Higher is better — cache reads cost ~10% of regular input.">
              cache hit
            </Hint>{' '}
            {Math.round((insights?.cost?.windows?.last7d?.cacheHitRate ?? 0) * 100)}%
          </p>
        </article>

        <article className="card">
          <p className="text-xs uppercase tracking-wider text-text-dim mb-3">
            <Hint text="Beads (issues) currently open, in progress, or closed in the project's bd tracker. P0–P3 are priority tiers; lower is more urgent.">
              Active work
            </Hint>
          </p>
          <p className="text-3xl font-semibold">
            {openBeads}<span className="text-base text-text-dim font-normal ml-1">open</span>
          </p>
          <p className="text-xs text-text-muted mt-1">
            {inProgressBeads} in progress · {insights?.beads?.byStatus?.closed ?? 0} closed
          </p>
          <div className="flex gap-2 mt-3 text-xs">
            {(['P0','P1','P2','P3'] as const).map((p) => {
              const count = insights?.beads?.byPriority?.[p] ?? 0;
              if (!count) return null;
              return (
                <span key={p} className="px-1.5 py-0.5 rounded bg-bg-muted font-mono" title={`Priority ${p.slice(1)}: ${count} issues. P0=critical, P1=high, P2=medium, P3=low.`}>
                  {p}:{count}
                </span>
              );
            })}
          </div>
        </article>
      </section>

      {/* TREND row — cost chart over time + service strip */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <article className="card lg:col-span-2" aria-labelledby="cost-trend-heading">
          <header className="flex items-baseline justify-between mb-3">
            <h2 id="cost-trend-heading" className="text-xs uppercase tracking-wider text-text-dim">
              <Hint text="Daily LLM spend over the last 7 days, pulled from Langfuse traces in this project. Bars turn amber on days with at least one errored trace. Empty / dim bars mean no traces that day.">
                Cost trend (7d)
              </Hint>
            </h2>
            <span className="text-xs text-text-dim">
              {insights?.langfuseTrend?.state === 'ok'
                ? `${insights.langfuseTrend.sampleSize} traces · ${insights.langfuseTrend.withCost} priced`
                : null}
            </span>
          </header>
          <CostTrendChart trend={insights?.langfuseTrend} />
        </article>

        <article className="card" aria-labelledby="services-strip-heading">
          <h2 id="services-strip-heading" className="text-xs uppercase tracking-wider text-text-dim mb-3">Services</h2>
          {services.length === 0 ? (
            <p className="text-xs text-text-muted">
              No services reported. Run <code className="px-1 py-0.5 bg-bg-muted rounded">construct up</code>.
            </p>
          ) : (
            <ul className="space-y-2">
              {services.map((s, i) => (
                <li key={i} className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{s.name}</div>
                    {s.note && <div className="text-xs text-text-dim truncate">{s.note}</div>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={pipClass(s.status)}>
                      <span aria-hidden="true">{statusIcon(s.status)}</span>
                      {s.status}
                    </span>
                    {s.url && (
                      <a href={s.url} target="_blank" rel="noreferrer" className="text-xs text-text-dim hover:text-text" aria-label={`open ${s.name}`}>
                        ↗
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      {/* COST DETAIL — cache savings + token mix */}
      <section aria-labelledby="cost-detail-heading" className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <h2 id="cost-detail-heading" className="sr-only">Cost detail</h2>

        <article className="card">
          <p className="text-xs uppercase tracking-wider text-text-dim mb-2">
            {everythingSubscription ? (
              <Hint text="On a subscription plan you don't see dollar savings directly — your monthly fee is flat. But the cache still reduces the *input tokens* counted against your plan's rate limits. The number below is the share of input that was served from cache instead of consuming fresh input quota.">
                Token cache efficiency (7d)
              </Hint>
            ) : (
              <Hint text="Estimated dollars saved by Anthropic's prompt cache over the last 7 days. Cache reads cost ~10% of regular input; cache writes cost ~25% more upfront but pay back across reuses. This is an order-of-magnitude estimate, not an audit figure.">
                Cache savings (7d, est.)
              </Hint>
            )}
          </p>
          {insights?.cost?.cacheSavings ? (
            everythingSubscription ? (
              <>
                <p className="text-2xl font-semibold" style={{ color: 'var(--status-healthy)' }}>
                  {Math.round((insights.cost.cacheSavings.savingsRatio || 0) * 100)}<span className="text-xs text-text-dim font-normal ml-1">% efficient</span>
                </p>
                <p className="text-xs text-text-muted mt-1">
                  {(insights.cost.windows?.last7d?.inputTokens || 0) > 0 || (insights.cost.tokenMix?.cacheRead || 0) > 0 ? (
                    <>
                      {(insights.cost.tokenMix?.cacheRead || 0).toLocaleString()} input tokens served from cache (10% rate-limit weight) vs {(insights.cost.tokenMix?.input || 0).toLocaleString()} paid input (100%)
                    </>
                  ) : 'No token usage yet.'}
                </p>
                <p className="text-xs text-text-dim mt-2">
                  Equivalent metered savings: ≈ ${insights.cost.cacheSavings.netSavedUsd.toFixed(2)} over the same window. Your real bill on a flat-rate plan is unchanged.
                </p>
                <p className="text-[10px] text-text-dim mt-1 font-mono">
                  billing mode: subscription · cached input is rate-limit friendly, dollar savings don't apply
                </p>
              </>
            ) : (
              <>
                <p className="text-2xl font-semibold" style={{ color: 'var(--status-healthy)' }}>
                  ≈ ${insights.cost.cacheSavings.netSavedUsd.toFixed(2)}
                  <span className="text-xs text-text-dim font-normal ml-2">net</span>
                </p>
                <p className="text-xs text-text-muted mt-1">
                  Actual{' '}
                  <Hint text="Actual money spent on LLM calls over the 7-day window, summed from the cost ledger.">7d cost</Hint>{' '}
                  ${(insights.cost.windows?.last7d?.totalCostUsd ?? 0).toFixed(2)} ·{' '}
                  without cache it would have cost ≈ ${insights.cost.cacheSavings.wouldHaveCostUsd.toFixed(2)}
                </p>
                <p className="text-xs text-text-dim mt-2">
                  ≈ ${insights.cost.cacheSavings.grossSavedUsd.toFixed(2)} gross saved − ${insights.cost.cacheSavings.writePremiumUsd.toFixed(2)} cache-write premium
                </p>
                <p
                  className="text-[10px] text-text-dim mt-1 font-mono"
                  title={`Approximation: cacheReadTokens × avgInputPrice × 0.9 − cacheCreationTokens × avgInputPrice × 0.25.\navgInputPrice is token-weighted across the models that ran in the window.\nModels: ${(insights.cost.cacheSavings.modelsInWindow || []).join(', ') || '(unknown)'}.`}
                >
                  weighted across {insights.cost.cacheSavings.modelsInWindow?.length || 1} model{insights.cost.cacheSavings.modelsInWindow?.length === 1 ? '' : 's'} · approx
                </p>
              </>
            )
          ) : (
            <p className="text-xs text-text-muted">No cache stats yet.</p>
          )}
        </article>

        <article className="card lg:col-span-2">
          <p className="text-xs uppercase tracking-wider text-text-dim mb-3">
            <Hint text="Stacked bar of token usage over the last 7 days. Cache-read = served from prompt cache (cheap). Cache-write = first-time-stored to cache (slight premium). Input = uncached input. Output = generated tokens. Reasoning = extended-thinking tokens (priced like output).">
              Token mix (7d)
            </Hint>
          </p>
          {insights?.cost?.tokenMix?.total > 0 ? (
            <>
              <div className="flex h-3 rounded overflow-hidden border border-border">
                {(() => {
                  const m = insights.cost.tokenMix;
                  const slices = [
                    { key: 'cacheRead', label: 'Cache read', value: m.cacheRead, color: 'var(--aurora-cyan)' },
                    { key: 'cacheCreation', label: 'Cache write', value: m.cacheCreation, color: 'var(--aurora-violet)' },
                    { key: 'input', label: 'Input', value: m.input, color: 'var(--aurora-mint)' },
                    { key: 'output', label: 'Output', value: m.output, color: 'var(--aurora-pink)' },
                    { key: 'reasoning', label: 'Reasoning', value: m.reasoning, color: 'var(--ink-500)' },
                  ];
                  return slices.filter((s) => s.value > 0).map((s) => (
                    <div
                      key={s.key}
                      style={{ width: `${(s.value / m.total) * 100}%`, background: s.color }}
                      title={`${s.label}: ${s.value.toLocaleString()} (${((s.value / m.total) * 100).toFixed(1)}%)`}
                    />
                  ));
                })()}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-3 text-xs">
                {(['cacheRead','cacheCreation','input','output','reasoning'] as const).map((key) => {
                  const m = insights.cost.tokenMix;
                  if (!m[key]) return null;
                  const colorMap: any = { cacheRead: 'var(--aurora-cyan)', cacheCreation: 'var(--aurora-violet)', input: 'var(--aurora-mint)', output: 'var(--aurora-pink)', reasoning: 'var(--ink-500)' };
                  const labelMap: any = { cacheRead: 'Cache read', cacheCreation: 'Cache write', input: 'Input', output: 'Output', reasoning: 'Reasoning' };
                  return (
                    <div key={key} className="flex items-start gap-2">
                      <span className="w-2 h-2 rounded-full mt-1 flex-shrink-0" style={{ background: colorMap[key] }} aria-hidden="true" />
                      <div className="min-w-0">
                        <div className="text-text-dim text-[10px] uppercase tracking-wider">{labelMap[key]}</div>
                        <div className="font-mono">{m[key].toLocaleString()}</div>
                        <div className="text-text-dim text-[10px]">{((m[key] / m.total) * 100).toFixed(1)}%</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="text-xs text-text-muted">No token usage yet.</p>
          )}
        </article>
      </section>

      {/* OBSERVABILITY row — latency, TTFT, throughput, errors, recall */}
      <section aria-labelledby="obs-heading">
        <h2 id="obs-heading" className="text-xs uppercase tracking-wider text-text-dim mb-3">
          <Hint text="LLM behavior metrics over the last 7 days, from Langfuse generation observations. Each card answers a different question about how the agent is performing.">
            Observability (last 7d)
          </Hint>
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <article className="card">
            <p className="text-xs uppercase tracking-wider text-text-dim mb-2">
              <Hint text="End-to-end response time of a single LLM generation (start → done). p50 = median (half the calls were faster, half slower). p95 / p99 = the 95th / 99th percentile — useful for spotting tail-latency outliers.">
                Latency
              </Hint>
            </p>
            {insights?.langfuseLatency?.state === 'ok' ? (
              <>
                <p className="text-xl font-semibold">
                  {Math.round(insights.langfuseLatency.latencyMs.p50)}<span className="text-xs text-text-dim font-normal ml-1">ms p50</span>
                </p>
                <p className="text-xs text-text-muted mt-1">
                  p95 {Math.round(insights.langfuseLatency.latencyMs.p95)}ms · p99 {Math.round(insights.langfuseLatency.latencyMs.p99)}ms
                </p>
                <p className="text-xs text-text-dim mt-2">{insights.langfuseLatency.sampleSize} generations</p>
              </>
            ) : (
              <p className="text-xs text-text-muted">{insights?.langfuseLatency?.message || 'No Langfuse generations.'}</p>
            )}
          </article>

          <article className="card">
            <p className="text-xs uppercase tracking-wider text-text-dim mb-2">
              <Hint text="Time-to-first-token: how long after a request starts before the first character streams back. Measures perceived 'is it doing anything?' lag. p50 is the median, p95 is the slow-side outlier.">
                TTFT
              </Hint>
            </p>
            {insights?.langfuseLatency?.state === 'ok' && insights.langfuseLatency.ttftMs ? (
              <>
                <p className="text-xl font-semibold">
                  {Math.round(insights.langfuseLatency.ttftMs.p50)}<span className="text-xs text-text-dim font-normal ml-1">ms p50</span>
                </p>
                <p className="text-xs text-text-muted mt-1">
                  p95 {Math.round(insights.langfuseLatency.ttftMs.p95)}ms
                </p>
                <p className="text-xs text-text-dim mt-2">{insights.langfuseLatency.ttftMs.sampleSize} timed</p>
              </>
            ) : (
              <p className="text-xs text-text-muted">No TTFT data — model didn't report completionStartTime.</p>
            )}
          </article>

          <article className="card">
            <p className="text-xs uppercase tracking-wider text-text-dim mb-2">
              <Hint text="Tokens-per-second of the streamed response (output tokens / completion duration). Higher is faster generation; varies by model. Doesn't include time-to-first-token.">
                Throughput
              </Hint>
            </p>
            {insights?.langfuseLatency?.state === 'ok' && insights.langfuseLatency.tokensPerSecond ? (
              <>
                <p className="text-xl font-semibold">
                  {Math.round(insights.langfuseLatency.tokensPerSecond.p50)}<span className="text-xs text-text-dim font-normal ml-1">tok/s p50</span>
                </p>
                <p className="text-xs text-text-muted mt-1">
                  p95 {Math.round(insights.langfuseLatency.tokensPerSecond.p95)} tok/s
                </p>
              </>
            ) : (
              <p className="text-xs text-text-muted">Need completion tokens + TTFT to compute.</p>
            )}
          </article>

          <article className="card">
            <p className="text-xs uppercase tracking-wider text-text-dim mb-2">
              <Hint text="Share of LLM generations marked level=error in Langfuse: API failures, refusals, schema parse failures. Amber over 1%, red over 5%. Sample is the last 50 generations.">
                Error rate
              </Hint>
            </p>
            {insights?.langfuseLatency?.state === 'ok' ? (
              <>
                <p className="text-xl font-semibold" style={{ color: insights.langfuseLatency.errorRate > 0.05 ? 'var(--status-down)' : insights.langfuseLatency.errorRate > 0.01 ? 'var(--status-degraded)' : 'inherit' }}>
                  {(insights.langfuseLatency.errorRate * 100).toFixed(1)}<span className="text-xs text-text-dim font-normal ml-1">%</span>
                </p>
                <p className="text-xs text-text-muted mt-1">
                  {insights.langfuseLatency.errorCount} of {insights.langfuseLatency.sampleSize}
                </p>
              </>
            ) : (
              <p className="text-xs text-text-muted">—</p>
            )}
          </article>

          <article className="card">
            <p className="text-xs uppercase tracking-wider text-text-dim mb-2">
              <Hint text="Recall@5: of the documents that *should* have been retrieved for each fixture query, what share appeared in the top 5 returned results. 100% = the right doc is always in the top 5. MRR is mean reciprocal rank — 1.0 means the right doc is always first. Run `construct evals retrieval` to refresh.">
                Retrieval recall@5
              </Hint>
            </p>
            {insights?.retrievalEval?.state === 'ok' ? (
              <>
                <p className="text-xl font-semibold">
                  {((insights.retrievalEval.recallAt5 ?? 0) * 100).toFixed(0)}<span className="text-xs text-text-dim font-normal ml-1">%</span>
                </p>
                <p className="text-xs text-text-muted mt-1">
                  MRR {(insights.retrievalEval.mrr ?? 0).toFixed(2)} · p95 {Math.round(insights.retrievalEval.p95LatencyMs || 0)}ms
                </p>
                <p className="text-xs text-text-dim mt-2">
                  {insights.retrievalEval.queryCount} queries · {new Date(insights.retrievalEval.ranAt).toLocaleDateString()}
                </p>
                {insights.retrievalEval.history?.length > 1 && (
                  <svg viewBox="0 0 60 16" className="w-full h-4 mt-2" preserveAspectRatio="none" aria-label="recall@5 history">
                    {(() => {
                      const h = insights.retrievalEval.history;
                      const pts = h.map((p: any, i: number) => {
                        const x = (i / Math.max(1, h.length - 1)) * 60;
                        const y = 16 - (Number(p.recallAt5 ?? 0) * 16);
                        return `${x.toFixed(1)},${y.toFixed(1)}`;
                      }).join(' ');
                      return <polyline points={pts} fill="none" stroke="var(--aurora-cyan)" strokeWidth="1.2" />;
                    })()}
                  </svg>
                )}
              </>
            ) : (
              <p className="text-xs text-text-muted">
                Run <code className="bg-bg-muted px-1 rounded">construct evals retrieval</code>
              </p>
            )}
          </article>
        </div>

        {insights?.langfuseLatency?.state === 'ok' && (insights.langfuseLatency.perModel?.length > 0 || insights.langfuseLatency.perAgent?.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-3">
            {insights.langfuseLatency.perModel?.length > 0 && (
              <article className="card">
                <p className="text-xs uppercase tracking-wider text-text-dim mb-3">Latency by model</p>
                <table className="w-full text-sm">
                  <thead className="text-xs text-text-dim">
                    <tr>
                      <th className="text-left font-normal pb-2">Model</th>
                      <th className="text-right font-normal pb-2">Generations</th>
                      <th className="text-right font-normal pb-2">Avg</th>
                      <th className="text-right font-normal pb-2">Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {insights.langfuseLatency.perModel.map((m: any) => (
                      <tr key={m.model} className="border-t border-border">
                        <td className="py-2 font-mono text-xs truncate max-w-[200px]">{m.model}</td>
                        <td className="py-2 text-right">{m.traces}</td>
                        <td className="py-2 text-right">{m.avgMs}ms</td>
                        <td className="py-2 text-right" style={{ color: m.errors > 0 ? 'var(--status-down)' : 'inherit' }}>{m.errors}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </article>
            )}
            {insights.langfuseLatency.perAgent?.length > 0 && (
              <article className="card">
                <p className="text-xs uppercase tracking-wider text-text-dim mb-3">Latency by agent</p>
                <table className="w-full text-sm">
                  <thead className="text-xs text-text-dim">
                    <tr>
                      <th className="text-left font-normal pb-2">Agent</th>
                      <th className="text-right font-normal pb-2">Generations</th>
                      <th className="text-right font-normal pb-2">Avg</th>
                      <th className="text-right font-normal pb-2">Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {insights.langfuseLatency.perAgent.map((a: any) => (
                      <tr key={a.agent} className="border-t border-border">
                        <td className="py-2 font-mono text-xs truncate max-w-[200px]">{a.agent}</td>
                        <td className="py-2 text-right">{a.traces}</td>
                        <td className="py-2 text-right">{a.avgMs}ms</td>
                        <td className="py-2 text-right" style={{ color: a.errors > 0 ? 'var(--status-down)' : 'inherit' }}>{a.errors}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </article>
            )}
          </div>
        )}
      </section>

      {/* SECONDARY row — resource caps + queue depths */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" aria-labelledby="secondary-heading">
        <h2 id="secondary-heading" className="sr-only">Resources and queues</h2>

        <article className="card">
          <p className="text-xs uppercase tracking-wider text-text-dim mb-2">.cx/ disk</p>
          <p className="text-xl font-semibold">{diskMb.toFixed(1)}<span className="text-xs text-text-dim font-normal ml-1">MB</span></p>
          <p className="text-xs text-text-muted">/ {diskCapMb.toFixed(0)}MB cap</p>
          <ProgressBar ratio={diskRatio} />
        </article>

        <article className="card">
          <p className="text-xs uppercase tracking-wider text-text-dim mb-2">Handoffs</p>
          {insights?.handoffs?.state === 'ok' ? (
            <>
              <p className="text-xl font-semibold">{insights.handoffs.total}</p>
              <p className="text-xs text-text-muted">oldest {insights.handoffs.oldestAgeDays?.toFixed(0)}d / {insights.handoffs.maxDays}d</p>
              {insights.handoffs.pastRetentionCount > 0 && (
                <p className="text-xs mt-2" style={{ color: 'var(--status-degraded)' }}>
                  {insights.handoffs.pastRetentionCount} past retention
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-text-muted">empty</p>
          )}
        </article>

        <article className="card">
          <p className="text-xs uppercase tracking-wider text-text-dim mb-2">Intake queue</p>
          {insights?.intake?.state === 'ok' ? (
            <>
              <p className="text-xl font-semibold">{insights.intake.pending}</p>
              <p className="text-xs text-text-muted">pending</p>
              <p className="text-xs text-text-dim mt-1">
                processed {insights.intake.processed} · skipped {insights.intake.skipped}
              </p>
            </>
          ) : (
            <p className="text-xs text-text-muted">empty · drop a file in <code className="bg-bg-muted px-1 rounded">.cx/inbox/</code></p>
          )}
        </article>

        <article className="card">
          <p className="text-xs uppercase tracking-wider text-text-dim mb-2">Vector index</p>
          {insights?.vector?.state === 'ok' ? (
            <>
              <p className="text-xl font-semibold">{insights.vector.records?.toLocaleString() ?? '—'}</p>
              <p className="text-xs text-text-muted">records · {(insights.vector.bytes / 1024).toFixed(1)}KB</p>
              {insights.vector.model && (
                <p className="text-xs text-text-dim mt-1 font-mono truncate">{insights.vector.model}</p>
              )}
            </>
          ) : (
            <p className="text-xs text-text-muted">
              {insights?.vector?.message || 'No index yet. Run `construct ingest`.'}
            </p>
          )}
        </article>
      </section>

      {/* PROVIDERS row — one card with provider connection status */}
      <section className="card" aria-labelledby="providers-heading">
        <header className="flex items-baseline justify-between mb-3">
          <h2 id="providers-heading" className="text-xs uppercase tracking-wider text-text-dim">Model providers</h2>
          <a href="#/providers" className="text-xs text-text-dim hover:text-text">manage ↗</a>
        </header>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {(insights?.providers ?? []).map((p: any) => (
            <div key={p.id} className="flex items-center gap-2 text-sm">
              <span className={pipClass(p.state)}>
                <span aria-hidden="true">{statusIcon(p.state)}</span>
              </span>
              <span className="truncate">{p.displayName}</span>
            </div>
          ))}
        </div>
      </section>

      {/* LANGFUSE detail */}
      {insights?.langfuse?.state === 'ok' && insights.langfuse.topModels?.length > 0 && (
        <section className="card" aria-labelledby="topmodels-heading">
          <header className="flex items-baseline justify-between mb-3">
            <h2 id="topmodels-heading" className="text-xs uppercase tracking-wider text-text-dim">Top models by cost</h2>
            <a href={insights.langfuse.baseUrl} target="_blank" rel="noreferrer" className="text-xs text-text-dim hover:text-text">
              Open Langfuse ↗
            </a>
          </header>
          <table className="w-full text-sm">
            <thead className="text-xs text-text-dim">
              <tr>
                <th className="text-left font-normal pb-2">Model</th>
                <th className="text-right font-normal pb-2">Traces</th>
                <th className="text-right font-normal pb-2">Cost (USD)</th>
              </tr>
            </thead>
            <tbody>
              {insights.langfuse.topModels.map((m: any, i: number) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-2 font-mono text-xs">{m.model}</td>
                  <td className="py-2 text-right">{m.traces}</td>
                  <td className="py-2 text-right">${m.cost.toFixed(6)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* AUTH footer */}
      <section className="card" aria-labelledby="auth-heading">
        <h2 id="auth-heading" className="text-xs uppercase tracking-wider text-text-dim mb-3">Authentication</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-text-dim text-xs mb-1">Mode</p>
            <p>{auth?.auth?.mode ?? 'token'}</p>
          </div>
          <div>
            <p className="text-text-dim text-xs mb-1">Providers</p>
            <p>{auth?.auth?.providers?.length ? auth.auth.providers.join(', ') : 'none'}</p>
          </div>
          <div>
            <p className="text-text-dim text-xs mb-1">Token</p>
            <p>{auth?.auth?.tokenConfigured ? 'configured' : 'not configured'}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
