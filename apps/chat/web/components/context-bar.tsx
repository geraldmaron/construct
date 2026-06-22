/**
 * apps/chat/web/components/context-bar.tsx — context window progress pill for the topbar.
 *
 * Color transitions: green → amber at 70% → red at 85%.
 */

'use client';

import type { SessionMeta } from '../types';

type ContextBarProps = {
  ctx: SessionMeta['ctx'];
};

function contextClass(pct: number): string {
  if (pct >= 85) return 'cx-ctx-bar-danger';
  if (pct >= 70) return 'cx-ctx-bar-warn';
  return 'cx-ctx-bar-ok';
}

export function ContextBar({ ctx }: ContextBarProps) {
  if (!ctx?.size) return null;
  const ratio = Math.max(0, Math.min(1, ctx.used / ctx.size));
  const pct = Math.round(ratio * 100);

  return (
    <div className={`cx-ctx-bar ${contextClass(pct)}`} title={`Context: ${pct}% (${ctx.used}/${ctx.size})`}>
      <div className="cx-ctx-bar-track" aria-hidden>
        <div className="cx-ctx-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="cx-ctx-bar-label">{pct}%</span>
    </div>
  );
}
