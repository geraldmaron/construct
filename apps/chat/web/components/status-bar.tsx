/**
 * apps/chat/web/components/status-bar.tsx — app bar with brand, session, model, and inspector toggle.
 *
 * Monochrome design: white diamond mark, mono session pill, total-tokens chip,
 * and a model chip carrying a pulsing white liveness dot. Context lives in the
 * inspector telemetry panel, not the bar.
 */

'use client';

import type { SessionMeta } from '../types';
import { formatTokens } from '../lib/format';

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
    return sessionMeta.model ?? 'free-router';
  }
  return sessionMeta.model ?? 'choose model';
}

export function StatusBar({
  sessionMeta,
  streaming,
  onOpenModelPicker,
  onToggleInspector,
  inspectorOpen,
}: StatusBarProps) {
  const model = modelLabel(sessionMeta);
  const turns = sessionMeta.usage?.turns ?? 0;
  const totalTokens = sessionMeta.usage?.tokens?.total ?? 0;

  return (
    <header className="cx-conv-header" aria-label="Session">
      <div className="cx-conv-header-left">
        <span className="cx-conv-brand-mark" aria-hidden />
        <h1 className="cx-conv-brand-title">Construct</h1>
        <span className="cx-conv-session-pill">
          {`SESSION · ${turns} TURN${turns === 1 ? '' : 'S'}`}
        </span>
      </div>
      <div className="cx-conv-header-right">
        {totalTokens > 0 && (
          <span className="cx-conv-total-chip" title="Session tokens">
            <span className="cx-conv-total-label">TOTAL</span>
            <span className="cx-conv-total-value">{formatTokens(totalTokens)}</span>
            <span className="cx-conv-total-unit">tok</span>
          </span>
        )}
        <button
          type="button"
          className="cx-conv-model-chip"
          onClick={onOpenModelPicker}
          aria-label={`Change model. Current: ${model}`}
        >
          {model}
          <span
            className={`cx-conv-status-dot ${streaming ? 'cx-conv-status-working' : 'cx-conv-status-ready'}`}
            aria-hidden
          />
          <span className="cx-conv-model-caret" aria-hidden>▾</span>
        </button>
        <button
          type="button"
          className={`cx-conv-inspector-toggle ${inspectorOpen ? 'cx-conv-inspector-open' : ''}`}
          onClick={onToggleInspector}
          aria-label={inspectorOpen ? 'Close inspector' : 'Open inspector'}
          aria-pressed={inspectorOpen}
        >
          ≡
        </button>
      </div>
    </header>
  );
}
