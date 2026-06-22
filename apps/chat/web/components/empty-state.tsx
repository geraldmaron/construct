/**
 * apps/chat/web/components/empty-state.tsx — onboarding panel for an empty chat session.
 */

'use client';

import type { SessionMeta } from '../types';

type EmptyStateProps = {
  sessionMeta: SessionMeta;
};

function splitModel(id?: string | null) {
  if (!id) return { provider: '', name: '(no model)' };
  const idx = id.indexOf('/');
  if (idx === -1) return { provider: '', name: id };
  return { provider: id.slice(0, idx), name: id.slice(idx + 1) };
}

export function EmptyState({ sessionMeta }: EmptyStateProps) {
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
        Open the inspector (☰) for session telemetry, token usage, and layer controls.
      </p>

      <ul className="cx-cockpit-welcome-list">
        <li>Ask a question or describe the change you want.</li>
        <li>Shift+Enter for a newline; Tab completes slash commands.</li>
        <li>Ctrl+1–5 toggles transparency layers; Esc cancels an active stream.</li>
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
