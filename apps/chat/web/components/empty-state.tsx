/**
 * apps/chat/web/components/empty-state.tsx — onboarding panel for an empty chat session.
 *
 * Quick actions open in-app pickers; nothing links out to dashboard routes.
 */

'use client';

import type { SessionMeta } from '../types';

type EmptyStateProps = {
  sessionMeta: SessionMeta;
  onOpenModelPicker: () => void;
  onOpenSettingsPicker: () => void;
};

function splitModel(id?: string | null) {
  if (!id) return { provider: '', name: '(no model)' };
  const idx = id.indexOf('/');
  if (idx === -1) return { provider: '', name: id };
  return { provider: id.slice(0, idx), name: id.slice(idx + 1) };
}

export function EmptyState({ sessionMeta, onOpenModelPicker, onOpenSettingsPicker }: EmptyStateProps) {
  const model = sessionMeta.modelMode === 'free-router'
    ? sessionMeta.model
    : sessionMeta.model;
  const { provider, name } = splitModel(model);
  const label = provider ? `${provider}/${name}` : name;
  const hasModel = Boolean(label && label !== '(no model)');

  return (
    <div className="cx-cockpit-welcome">
      <p className="cx-cockpit-welcome-eyebrow">Session ready</p>
      <h2 className="cx-cockpit-welcome-title">Start a turn with Construct</h2>
      <p className="cx-cockpit-muted cx-cockpit-welcome-lede">
        Each turn shows route, thinking, tools, sources, and usage inline before the answer.
        Session telemetry stays in the inspector on the right.
      </p>

      <div className="cx-cockpit-welcome-actions">
        <button type="button" className="cx-cockpit-welcome-btn" onClick={onOpenModelPicker}>
          {hasModel ? `model · ${label}` : 'choose model'}
        </button>
        <button type="button" className="cx-cockpit-welcome-btn cx-cockpit-welcome-btn-secondary" onClick={onOpenSettingsPicker}>
          settings · /set
        </button>
      </div>

      <ul className="cx-cockpit-welcome-list">
        <li>Ask a question or describe the change you want.</li>
        <li>Shift+Enter for a newline; Tab completes slash commands.</li>
        <li>Ctrl+1–6 toggles transparency layers; Esc cancels an active stream.</li>
      </ul>

      {!hasModel ? (
        <p className="cx-cockpit-warn">No model selected yet — pick one before your first turn.</p>
      ) : null}
      {sessionMeta.modelMode === 'free-router' ? (
        <p className="cx-cockpit-muted">Free-router re-picks on launch and on provider failure.</p>
      ) : null}
    </div>
  );
}
