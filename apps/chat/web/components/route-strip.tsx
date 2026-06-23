/**
 * apps/chat/web/components/route-strip.tsx — compact specialist route strip for event log.
 *
 * Renders formatRouteStrip output inline: intent, track, chain, gates, summary.
 */

'use client';

import type { RouteOverlay } from '../types';
import { formatRouteStrip } from '../../../../lib/chat/present.mjs';

type RouteStripProps = {
  overlay: RouteOverlay;
  layers?: Record<string, boolean>;
};

export function RouteStrip({ overlay, layers }: RouteStripProps) {
  const strip = formatRouteStrip(overlay, { layers });
  if (!strip) return null;

  const meta: string[] = [];
  if (strip.intent) meta.push(`intent=${strip.intent}`);
  if (strip.track) meta.push(`track=${strip.track}`);

  const hasPrimary = meta.length > 0 || Boolean(strip.chainLine);

  return (
    <span className="cx-cockpit-route-strip">
      {meta.length ? (
        <span className="cx-cockpit-route-strip-meta">{meta.join(' · ')}</span>
      ) : null}
      {meta.length && strip.chainLine ? (
        <span className="cx-cockpit-muted"> · </span>
      ) : null}
      {strip.chainLine ? (
        <span className="cx-cockpit-route-strip-chain">{strip.chainLine}</span>
      ) : null}
      {strip.gates?.length ? (
        <span className={`cx-cockpit-route-strip-gates${hasPrimary ? ' cx-cockpit-route-strip-block' : ''}`}>
          {strip.gates.map((g) => `${g.label}: ${g.value}`).join(' · ')}
        </span>
      ) : null}
      {strip.summary ? (
        <span className={`cx-cockpit-route-strip-summary cx-cockpit-muted${hasPrimary || strip.gates?.length ? ' cx-cockpit-route-strip-block' : ''}`}>
          {strip.summary}
        </span>
      ) : null}
    </span>
  );
}
