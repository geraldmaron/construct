/**
 * apps/chat/web/components/status-bar.tsx — topbar with brand, model, status, and context bar.
 */

'use client';

import type { SessionMeta } from '../types';
import { ContextBar } from './context-bar';

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
  const branch = sessionMeta.workingBranch;

  return (
    <header className="cx-conv-header" aria-label="Session">
      <div className="cx-conv-header-left">
        <span className="cx-conv-brand-mark" aria-hidden>◆</span>
        <h1 className="cx-conv-brand-title">Construct</h1>
        {branch && (
          <span className="cx-conv-branch-chip" title={`Branch: ${branch}`}>
            {branch}
          </span>
        )}
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
        <ContextBar ctx={sessionMeta.ctx} />
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
