/**
 * apps/chat/web/components/session-dock.tsx — model, oracle, context, usage ledger.
 *
 * Sits below RouteDock in the right column. Ports Ink SessionRail sections to
 * web without duplicating per-turn route detail.
 */

'use client';

import type { SessionMeta } from '../types';

type SessionDockProps = {
  sessionMeta: SessionMeta;
};

function contextMeter(ctx: SessionMeta['ctx']) {
  if (!ctx?.size) return null;
  const ratio = Math.max(0, Math.min(1, ctx.used / ctx.size));
  const width = 12;
  const filled = Math.round(ratio * width);
  return {
    bar: '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled)),
    label: `${ctx.used}/${ctx.size}`,
    pct: `${Math.round(ratio * 100)}%`,
  };
}

function formatTokens(n?: number) {
  if (!n) return '0';
  if (n < 1000) return String(n);
  if (n < 1000000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;
  return `${(n / 1000000).toFixed(1)}M`;
}

export function SessionDock({ sessionMeta }: SessionDockProps) {
  const meter = contextMeter(sessionMeta.ctx);
  const t = sessionMeta.usage?.tokens || {};
  const cost = sessionMeta.usage?.cost?.amount;

  return (
    <aside className="cx-cockpit-session" aria-label="Session telemetry">
      <h2 className="cx-cockpit-panel-title">session</h2>

      <section className="cx-cockpit-dock-section">
        <h3 className="cx-cockpit-dock-heading">model</h3>
        <p className="cx-cockpit-dock-body">
          {sessionMeta.modelMode === 'free-router'
            ? `free-router → ${sessionMeta.model || '?'}`
            : (sessionMeta.model || '(none)')}
        </p>
        {(sessionMeta.sandbox || sessionMeta.permissionMode) ? (
          <p className="cx-cockpit-muted">
            {[sessionMeta.sandbox, sessionMeta.permissionMode].filter(Boolean).join(' │ ')}
          </p>
        ) : null}
      </section>

      {sessionMeta.oracle?.visible ? (
        <section className="cx-cockpit-dock-section">
          <h3 className="cx-cockpit-dock-heading">oracle</h3>
          <p className="cx-cockpit-warn">{sessionMeta.oracle.summary}</p>
          {sessionMeta.oracle.topGaps.slice(0, 2).map((g) => (
            <p key={g.id} className="cx-cockpit-muted">{`${g.id}: ${g.detail}`}</p>
          ))}
        </section>
      ) : null}

      <section className="cx-cockpit-dock-section">
        <h3 className="cx-cockpit-dock-heading">context</h3>
        {meter ? (
          <>
            <p className="cx-cockpit-meter">{meter.bar}</p>
            <p className="cx-cockpit-muted">{`${meter.label}  ${meter.pct}`}</p>
          </>
        ) : (
          <p className="cx-cockpit-muted">not reported yet</p>
        )}
      </section>

      <section className="cx-cockpit-dock-section">
        <h3 className="cx-cockpit-dock-heading">usage</h3>
        {t.total ? (
          <>
            {t.input ? <p className="cx-cockpit-muted">{`prompt: ${formatTokens(t.input)}`}</p> : null}
            {t.output ? <p className="cx-cockpit-muted">{`output: ${formatTokens(t.output)}`}</p> : null}
            {t.reasoning ? <p className="cx-cockpit-muted">{`reasoning: ${formatTokens(t.reasoning)}`}</p> : null}
            <p className="cx-cockpit-muted">{`total: ${formatTokens(t.total)}`}</p>
            {cost ? <p className="cx-cockpit-muted">{`cost: ~$${cost.toFixed(cost < 1 ? 3 : 2)}`}</p> : null}
          </>
        ) : (
          <p className="cx-cockpit-muted">no tokens yet</p>
        )}
      </section>
    </aside>
  );
}
