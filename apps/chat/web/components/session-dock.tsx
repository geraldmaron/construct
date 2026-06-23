/**
 * apps/chat/web/components/session-dock.tsx — inspector rail for route, layers, and usage.
 *
 * Model and settings use in-app pickers. Route specialists stay in-session (no dashboard links).
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
  onOpenModelPicker?: () => void;
  onOpenSettingsPicker?: () => void;
};

function contextMeter(ctx: SessionMeta['ctx']) {
  if (!ctx?.size) return null;
  const ratio = Math.max(0, Math.min(1, ctx.used / ctx.size));
  return {
    pct: Math.round(ratio * 100),
    label: `${ctx.used}/${ctx.size}`,
  };
}

function formatTokens(n?: number) {
  if (!n) return '0';
  if (n < 1000) return String(n);
  if (n < 1000000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;
  return `${(n / 1000000).toFixed(1)}M`;
}

function modelLabel(sessionMeta: SessionMeta) {
  if (sessionMeta.modelMode === 'free-router') {
    return `free-router → ${sessionMeta.model || '?'}`;
  }
  return sessionMeta.model || '(none)';
}

export function SessionDock({
  sessionMeta,
  layers,
  overlay,
  streaming,
  onToggleLayer,
  onOpenModelPicker,
  onOpenSettingsPicker,
}: SessionDockProps) {
  const meter = contextMeter(sessionMeta.ctx);
  const t = sessionMeta.usage?.tokens || {};
  const turns = sessionMeta.usage?.turns ?? 0;
  const cost = sessionMeta.usage?.cost?.amount;

  const ledger: Array<[string, string]> = [];
  if (t.input) ledger.push(['prompt', formatTokens(t.input)]);
  if (t.output) ledger.push(['output', formatTokens(t.output)]);
  if (t.reasoning) ledger.push(['reasoning', formatTokens(t.reasoning)]);
  if (t.total) ledger.push(['total', formatTokens(t.total)]);
  if (cost && cost > 0) ledger.push(['cost', `~$${cost.toFixed(cost < 1 ? 3 : 2)}`]);

  return (
    <aside className="cx-cockpit-rail cx-cockpit-session" aria-label="Session inspector">
      <div className="cx-cockpit-rail-head">
        <h2 className="cx-cockpit-rail-title">Inspector</h2>
        <span className={`cx-cockpit-status-pill ${streaming ? 'cx-cockpit-status-pill-working' : 'cx-cockpit-status-pill-idle'}`}>
          {streaming ? 'working' : 'ready'}
        </span>
      </div>

      <section className="cx-cockpit-dock-section">
        <h3 className="cx-cockpit-dock-heading">Controls</h3>
        <div className="cx-cockpit-rail-actions">
          <button type="button" className="cx-cockpit-rail-btn" onClick={onOpenModelPicker}>
            change model
          </button>
          <button type="button" className="cx-cockpit-rail-btn" onClick={onOpenSettingsPicker}>
            settings
          </button>
        </div>
        <p className="cx-cockpit-dock-body">{modelLabel(sessionMeta)}</p>
      </section>

      {sessionMeta.oracle?.visible ? (
        <section className="cx-cockpit-dock-section">
          <h3 className="cx-cockpit-dock-heading">Oracle</h3>
          <p className="cx-cockpit-warn">{sessionMeta.oracle.summary}</p>
          {sessionMeta.oracle.topGaps.slice(0, 2).map((g) => (
            <p key={g.id} className="cx-cockpit-muted">{`${g.id}: ${g.detail}`}</p>
          ))}
          <p className="cx-cockpit-muted">/oracle for detail</p>
        </section>
      ) : null}

      <section className="cx-cockpit-dock-section">
        <h3 className="cx-cockpit-dock-heading">Layers</h3>
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
        <h3 className="cx-cockpit-dock-heading">Context</h3>
        {meter ? (
          <>
            <div className="cx-cockpit-meta-meter cx-cockpit-meta-meter-rail" aria-hidden>
              <span className="cx-cockpit-meta-meter-fill" style={{ width: `${meter.pct}%` }} />
            </div>
            <p className="cx-cockpit-muted">{`${meter.pct}% · ${meter.label}`}</p>
          </>
        ) : (
          <p className="cx-cockpit-muted">not reported yet</p>
        )}
      </section>

      <section className="cx-cockpit-dock-section">
        <h3 className="cx-cockpit-dock-heading">{`Usage · ${turns} turn${turns === 1 ? '' : 's'}`}</h3>
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
    </aside>
  );
}
