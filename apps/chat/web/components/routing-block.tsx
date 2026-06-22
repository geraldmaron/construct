/**
 * apps/chat/web/components/routing-block.tsx — always-visible specialist route row.
 *
 * Renders the dispatch chain as a flat row of chips joined by arrows, the final
 * hop inverted as the resolved endpoint. Full routing detail (intent, dispatch
 * reasons, contracts, risks) lives in the inspector Turn tab, not inline.
 */

'use client';

import { Fragment } from 'react';
import type { RouteOverlay } from '../types';

type RoutingBlockProps = {
  overlay: RouteOverlay | null;
  visible: boolean;
};

function specialistLabel(id: string): string {
  return id
    .replace(/^cx-/, '')
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function RoutingBlock({ overlay, visible }: RoutingBlockProps) {
  if (!visible || !overlay) return null;

  const chain = overlay.specialists ?? [];
  const reasons = overlay.dispatchReasons ?? {};

  return (
    <div className="cx-route-row">
      <span className="cx-route-label">ROUTE</span>
      {chain.length ? (
        chain.map((id, i) => (
          <Fragment key={`${id}-${i}`}>
            {i > 0 && <span className="cx-route-arrow" aria-hidden>→</span>}
            <span className="cx-route-chip" title={reasons[id] ?? undefined}>
              {specialistLabel(id)}
            </span>
          </Fragment>
        ))
      ) : (
        <span
          className="cx-route-direct"
          title={overlay.dispatchSummary ?? undefined}
        >
          direct response
        </span>
      )}
    </div>
  );
}
