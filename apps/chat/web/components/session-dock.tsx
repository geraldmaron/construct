/**
 * apps/chat/web/components/session-dock.tsx — bordered session rail (Ink SessionRail port).
 *
 * Model, oracle, layer toggles, route detail, context meter, usage ledger, and
 * idle/working indicator. Route detail merges into the rail via RouteSections.
 */

'use client';

import type { RouteOverlay, SessionMeta } from '../types';
import { LAYER_KEYS, type LayerKey } from '../types';
import { RouteSections } from './route-sections';

type SessionDockProps = {
  sessionMeta: SessionMeta;
  layers: Record<string, boolean>;
  overlay: RouteOverlay | null;
  streaming: boolean;
  onToggleLayer?: (key: LayerKey) => void;
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

export function SessionDock({ sessionMeta, layers, overlay, streaming, onToggleLayer }: SessionDockProps) {
  const meter = contextMeter(sessionMeta.ctx);
  const t = sessionMeta.usage?.tokens || {};
  const turns = sessionMeta.usage?.turns ?? 0;
  const cost = sessionMeta.usage?.cost?.amount;
  const modelLabel = sessionMeta.modelMode === 'free-router'
    ? `free-router → ${sessionMeta.model || '?'}`
    : (sessionMeta.model || '(none)');

  const ledger: Array<[string, string]> = [];
  if (t.input) ledger.push(['prompt', formatTokens(t.input)]);
  if (t.output) ledger.push(['output', formatTokens(t.output)]);
  if (t.reasoning) ledger.push(['reasoning', formatTokens(t.reasoning)]);
  if (t.total) ledger.push(['total', formatTokens(t.total)]);
  if (cost && cost > 0) ledger.push(['cost', `~$${cost.toFixed(cost < 1 ? 3 : 2)}`]);

  return (
    <aside className="cx-cockpit-rail cx-cockpit-session" aria-label="Session telemetry">
      <h2 className="cx-cockpit-rail-title">◆ session</h2>
      <hr className="cx-cockpit-rule cx-cockpit-rule-heavy" />

      <section className="cx-cockpit-dock-section">
        <h3 className="cx-cockpit-dock-heading">model</h3>
        <p className="cx-cockpit-dock-body">{modelLabel}</p>
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
          <p className="cx-cockpit-muted">/oracle for detail</p>
        </section>
      ) : null}

      <section className="cx-cockpit-dock-section">
        <h3 className="cx-cockpit-dock-heading">layers</h3>
        <div className="cx-cockpit-layer-row">
          {LAYER_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              className="cx-cockpit-layer-chip"
              aria-pressed={layers?.[k] !== false}
              onClick={() => onToggleLayer?.(k)}
            >
              {`${k}=${layers?.[k] !== false ? 'on' : 'off'}`}
            </button>
          ))}
        </div>
      </section>

      <RouteSections overlay={overlay} />

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
        <h3 className="cx-cockpit-dock-heading">{`usage │ ${turns} turn${turns === 1 ? '' : 's'}`}</h3>
        {ledger.length ? (
          ledger.map(([k, v]) => (
            <div key={k} className="cx-cockpit-ledger-row">
              <span>{k}</span>
              <span>{v}</span>
            </div>
          ))
        ) : (
          <p className="cx-cockpit-muted">no tokens yet</p>
        )}
      </section>

      <p className={`cx-cockpit-idle ${streaming ? 'cx-cockpit-idle-working' : ''}`}>
        {streaming ? '◌ working…' : '● idle'}
      </p>
    </aside>
  );
}
