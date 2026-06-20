/**
 * apps/chat/web/components/status-bar.tsx — minimal conversational header.
 */

'use client';

import type { SessionMeta } from '../types';

type StatusBarProps = {
  sessionMeta: SessionMeta;
  streaming: boolean;
  onOpenModelPicker: () => void;
  onOpenSettingsPicker: () => void;
  onToggleInspector: () => void;
  inspectorOpen: boolean;
};

function modelLabel(sessionMeta: SessionMeta) {
  if (sessionMeta.modelMode === 'free-router') {
    return sessionMeta.model || '?';
  }
  return sessionMeta.model || 'choose';
}

function contextPercent(ctx: SessionMeta['ctx']) {
  if (!ctx?.size) return null;
  const ratio = Math.max(0, Math.min(1, ctx.used / ctx.size));
  return Math.round(ratio * 100);
}

export function StatusBar({
  sessionMeta,
  streaming,
  onOpenModelPicker,
  onToggleInspector,
  inspectorOpen,
}: StatusBarProps) {
  const model = modelLabel(sessionMeta);
  const ctxPct = contextPercent(sessionMeta.ctx);

  return (
    <header className="cx-conv-header" aria-label="Session">
      <div className="cx-conv-header-left">
        <span className="cx-conv-brand-mark">◆</span>
        <h1 className="cx-conv-brand-title">Construct chat</h1>
      </div>
      <div className="cx-conv-header-right">
        <button
          type="button"
          className="cx-conv-model-chip"
          onClick={onOpenModelPicker}
          aria-label={`Change model. Current: ${model}`}
        >
          {model}
        </button>
        <span
          className={`cx-conv-status-dot ${streaming ? 'cx-conv-status-working' : 'cx-conv-status-ready'}`}
          role="status"
          aria-label={streaming ? 'working' : 'ready'}
          aria-hidden
        />
        {ctxPct !== null && <span className="cx-conv-ctx-label">{ctxPct}%</span>}
        <button
          type="button"
          className={`cx-conv-inspector-toggle ${inspectorOpen ? 'cx-conv-inspector-open' : ''}`}
          onClick={onToggleInspector}
          aria-label={inspectorOpen ? 'Close inspector' : 'Open inspector'}
          aria-pressed={inspectorOpen}
        >
          ☰
        </button>
      </div>
    </header>
  );
}
