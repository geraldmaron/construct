/**
 * apps/chat/web/components/status-bar.tsx — cockpit header with session controls.
 *
 * Model and settings open in-app pickers. Context and usage stay read-only.
 */

'use client';

import type { SessionMeta } from '../types';

type StatusBarProps = {
  sessionMeta: SessionMeta;
  streaming: boolean;
  onOpenModelPicker: () => void;
  onOpenSettingsPicker: () => void;
};

function contextMeter(ctx: SessionMeta['ctx']) {
  if (!ctx?.size) return null;
  const ratio = Math.max(0, Math.min(1, ctx.used / ctx.size));
  const pct = Math.round(ratio * 100);
  return { pct, label: `${ctx.used}/${ctx.size}` };
}

function usageLine(usage: SessionMeta['usage']) {
  if (!usage?.tokens?.total) return 'no tokens yet';
  const parts: string[] = [];
  if (usage.tokens.total) parts.push(`${usage.tokens.total} tok`);
  if (usage.cost?.amount) parts.push(`~$${usage.cost.amount.toFixed(usage.cost.amount < 1 ? 3 : 2)}`);
  if (usage.turns) parts.push(`${usage.turns} turn${usage.turns === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

function modelLabel(sessionMeta: SessionMeta) {
  if (sessionMeta.modelMode === 'free-router') {
    return `free-router → ${sessionMeta.model || '?'}`;
  }
  return sessionMeta.model || 'choose model';
}

export function StatusBar({
  sessionMeta,
  streaming,
  onOpenModelPicker,
  onOpenSettingsPicker,
}: StatusBarProps) {
  const meter = contextMeter(sessionMeta.ctx);
  const model = modelLabel(sessionMeta);

  return (
    <header className="cx-cockpit-header" aria-label="Session">
      <div className="cx-cockpit-header-main">
        <div className="cx-cockpit-header-brand">
          <span className="cx-cockpit-brand-mark" aria-hidden>◆</span>
          <div>
            <p className="cx-cockpit-brand-title">Construct chat</p>
            <p className="cx-cockpit-brand-sub">
              {sessionMeta.workingBranch ? `branch ${sessionMeta.workingBranch}` : 'owned agent loop'}
            </p>
          </div>
        </div>

        <div className="cx-cockpit-header-actions">
          <button
            type="button"
            className="cx-cockpit-action-chip cx-cockpit-action-chip-primary"
            onClick={onOpenModelPicker}
            aria-label={`Change model. Current: ${model}`}
          >
            <span className="cx-cockpit-action-chip-label">model</span>
            <span className="cx-cockpit-action-chip-value">{model}</span>
          </button>
          <button
            type="button"
            className="cx-cockpit-action-chip"
            onClick={onOpenSettingsPicker}
            aria-label="Open settings picker"
          >
            <span className="cx-cockpit-action-chip-label">settings</span>
            <span className="cx-cockpit-action-chip-value">/set</span>
          </button>
          <span
            className={`cx-cockpit-status-pill ${streaming ? 'cx-cockpit-status-pill-working' : 'cx-cockpit-status-pill-idle'}`}
            role="status"
          >
            {streaming ? 'working' : 'ready'}
          </span>
        </div>
      </div>

      <div className="cx-cockpit-header-meta">
        <div className="cx-cockpit-meta-group">
          {meter ? (
            <>
              <span className="cx-cockpit-meta-label">context</span>
              <span className="cx-cockpit-meta-meter" aria-hidden>
                <span className="cx-cockpit-meta-meter-fill" style={{ width: `${meter.pct}%` }} />
              </span>
              <span className="cx-cockpit-meta-value">{`${meter.pct}% · ${meter.label}`}</span>
            </>
          ) : (
            <span className="cx-cockpit-muted">context not reported yet</span>
          )}
        </div>
        <div className="cx-cockpit-meta-group">
          {[sessionMeta.sandbox, sessionMeta.permissionMode].filter(Boolean).map((value) => (
            <span key={value} className="cx-cockpit-meta-tag">{value}</span>
          ))}
          <span className="cx-cockpit-meta-value">{usageLine(sessionMeta.usage)}</span>
        </div>
      </div>
    </header>
  );
}
