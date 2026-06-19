/**
 * apps/chat/web/components/empty-state.tsx — TUI welcome screen for web chat.
 *
 * Matches apps/chat/tui/index.jsx EmptyState copy and structure.
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

  return (
    <div className="cx-cockpit-welcome">
      <p className="cx-cockpit-welcome-title">◆ welcome to construct chat</p>
      <p className="cx-cockpit-muted cx-cockpit-welcome-lede">
        Each turn shows route, thinking, tools, sources, and usage inline before the answer.
        Session metrics stay in the rail on the right. /set toggles layers; /inspect expands tool detail.
      </p>
      <p className="cx-cockpit-muted">To get going</p>
      <p className="cx-cockpit-welcome-item">▸ ask a question or describe the change you want</p>
      <p className="cx-cockpit-muted cx-cockpit-welcome-item">
        ▸ shift+enter newline   tab completes /commands   /model /set open searchable pickers
      </p>
      {label && label !== '(no model)' ? (
        <p className="cx-cockpit-welcome-model">
          <span className="cx-cockpit-muted">active model </span>
          <strong>{label}</strong>
        </p>
      ) : (
        <p className="cx-cockpit-warn">› no model selected — set one with /model or a provider key</p>
      )}
      {sessionMeta.modelMode === 'free-router' ? (
        <p className="cx-cockpit-muted">free-router — re-picks on launch and on failure</p>
      ) : null}
    </div>
  );
}
