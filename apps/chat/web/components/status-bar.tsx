/**
 * apps/chat/web/components/status-bar.tsx — session status strip for terminal cockpit.
 *
 * Model, sandbox, permission mode, context meter, branch, layer toggles, and
 * working indicator. Mirrors Ink SessionHeader in web form.
 */

'use client';

import type { SessionMeta } from '../types';
import { LAYER_KEYS } from '../types';

type StatusBarProps = {
  sessionMeta: SessionMeta;
  layers: Record<string, boolean>;
  streaming: boolean;
  onToggleLayer: (key: typeof LAYER_KEYS[number]) => void;
  onToggleRoute?: () => void;
  routeCount?: number;
  showRouteToggle?: boolean;
};

function contextMeter(ctx: SessionMeta['ctx']) {
  if (!ctx?.size) return null;
  const ratio = Math.max(0, Math.min(1, ctx.used / ctx.size));
  const width = 14;
  const filled = Math.round(ratio * width);
  const bar = '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
  return { bar, pct: `${Math.round(ratio * 100)}%` };
}

function usageLine(usage: SessionMeta['usage']) {
  if (!usage?.tokens?.total) return 'no tokens yet';
  const parts: string[] = [];
  if (usage.tokens.total) parts.push(`${usage.tokens.total} tok`);
  if (usage.cost?.amount) parts.push(`~$${usage.cost.amount.toFixed(usage.cost.amount < 1 ? 3 : 2)}`);
  if (usage.turns) parts.push(`${usage.turns} turn${usage.turns === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

export function StatusBar({
  sessionMeta,
  layers,
  streaming,
  onToggleLayer,
  onToggleRoute,
  routeCount = 0,
  showRouteToggle = false,
}: StatusBarProps) {
  const meter = contextMeter(sessionMeta.ctx);
  const modelLabel = sessionMeta.modelMode === 'free-router'
    ? `free-router → ${sessionMeta.model || '?'}`
    : (sessionMeta.model || '(no model)');

  return (
    <header className="cx-cockpit-status" aria-label="Session status">
      <div className="cx-cockpit-status-row">
        <div className="cx-cockpit-status-left">
          <span className="cx-cockpit-brand">◆ construct</span>
          <span className="cx-cockpit-gutter">│</span>
          <span className="cx-cockpit-muted">chat</span>
        </div>
        <div className="cx-cockpit-status-right">
          <span className="cx-cockpit-model">{modelLabel}</span>
          {sessionMeta.sandbox ? (
            <>
              <span className="cx-cockpit-gutter">│</span>
              <span className="cx-cockpit-muted">{sessionMeta.sandbox}</span>
            </>
          ) : null}
          {sessionMeta.permissionMode ? (
            <>
              <span className="cx-cockpit-gutter">│</span>
              <span className="cx-cockpit-muted">{sessionMeta.permissionMode}</span>
            </>
          ) : null}
          <span className={`cx-cockpit-dot ${streaming ? 'cx-cockpit-dot-working' : 'cx-cockpit-dot-idle'}`} aria-hidden />
          <span className="cx-cockpit-sr-only">{streaming ? 'working' : 'idle'}</span>
        </div>
      </div>

      <div className="cx-cockpit-status-row">
        <div className="cx-cockpit-status-left">
          {meter ? (
            <span className="cx-cockpit-muted">
              context
              {' '}
              <span className="cx-cockpit-meter">{meter.bar}</span>
              {' '}
              {meter.pct}
            </span>
          ) : (
            <span className="cx-cockpit-muted">context not reported yet</span>
          )}
        </div>
        <span className="cx-cockpit-muted">{`session ${usageLine(sessionMeta.usage)}`}</span>
      </div>

      <div className="cx-cockpit-status-row cx-cockpit-status-layers">
        <span className="cx-cockpit-muted">layers</span>
        {LAYER_KEYS.map((key, i) => (
          <span key={key} className="cx-cockpit-layer-pill-wrap">
            {i > 0 ? <span className="cx-cockpit-gutter">│</span> : null}
            <button
              type="button"
              className="cx-cockpit-layer-btn"
              aria-pressed={layers[key] !== false}
              onClick={() => onToggleLayer(key)}
            >
              {`${key}${layers[key] !== false ? '' : '✗'}`}
            </button>
          </span>
        ))}
        {sessionMeta.workingBranch ? (
          <>
            <span className="cx-cockpit-gutter">│</span>
            <span className="cx-cockpit-muted">{`branch ${sessionMeta.workingBranch}`}</span>
          </>
        ) : null}
        {showRouteToggle ? (
          <button type="button" className="cx-cockpit-route-toggle" onClick={onToggleRoute}>
            {`route · ${routeCount} specialists`}
          </button>
        ) : null}
      </div>

      <hr className="cx-cockpit-rule cx-cockpit-rule-heavy" />
    </header>
  );
}
