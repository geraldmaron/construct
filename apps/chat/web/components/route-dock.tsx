/**
 * apps/chat/web/components/route-dock.tsx — persistent specialist route panel.
 *
 * Shows the current turn's planned orchestration path: track, chain, dispatch
 * reasons, contract edges, gates, and risk flags. Stays visible while output
 * streams in the event log.
 */

'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import type { RouteOverlay } from '../types';

type RouteDockProps = {
  overlay: RouteOverlay | null;
  turnIndex?: number;
};

function DockSection({ title, children }: { title: string; children: ReactNode }) {
  if (!children) return null;
  return (
    <section className="cx-cockpit-dock-section">
      <h3 className="cx-cockpit-dock-heading">{title}</h3>
      <div className="cx-cockpit-dock-body">{children}</div>
    </section>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="cx-cockpit-kv">
      <span className="cx-cockpit-kv-label">{label}</span>
      <span className={accent ? 'cx-cockpit-kv-value cx-cockpit-accent' : 'cx-cockpit-kv-value'}>{value}</span>
    </div>
  );
}

export function RouteDock({ overlay, turnIndex }: RouteDockProps) {
  if (!overlay) {
    return (
      <aside className="cx-cockpit-route" aria-label="Specialist route">
        <h2 className="cx-cockpit-panel-title">route</h2>
        <p className="cx-cockpit-muted">Send a message to compute the specialist route.</p>
      </aside>
    );
  }

  const risks = overlay.riskFlags
    ? Object.entries(overlay.riskFlags).filter(([, v]) => v).map(([k]) => k)
    : [];
  const chain = overlay.specialists || [];
  const reasons = overlay.dispatchReasons || {};
  const triggers = overlay.triggers || [];

  return (
    <aside className="cx-cockpit-route" aria-label="Specialist route">
      <h2 className="cx-cockpit-panel-title">
        route
        {turnIndex != null ? ` · turn ${turnIndex}` : ''}
      </h2>

      <DockSection title="classification">
        {overlay.track ? <Row label="track" value={overlay.track} /> : null}
        {overlay.intent ? <Row label="intent" value={overlay.intent} /> : null}
        {overlay.workCategory ? <Row label="category" value={overlay.workCategory} /> : null}
        {overlay.priorIntent ? <Row label="prior" value={overlay.priorIntent} /> : null}
        {risks.length ? <Row label="risk" value={risks.join(', ')} /> : null}
      </DockSection>

      <DockSection title="specialists">
        {chain.length ? (
          <p className="cx-cockpit-route-chain" aria-label="Specialist chain">
            {chain.map((id, i) => (
              <span key={id}>
                {i > 0 ? <span className="cx-cockpit-muted"> → </span> : null}
                <Link href={`/agents/`} className="cx-cockpit-link">{id}</Link>
              </span>
            ))}
          </p>
        ) : (
          <p className="cx-cockpit-muted">immediate — Construct responds directly</p>
        )}
      </DockSection>

      <DockSection title="dispatch">
        {triggers.map((t) => (
          <Row key={`${t.specialist}-${t.reason}`} label={t.specialist} value={t.reason} />
        ))}
        {Object.entries(reasons).map(([spec, reason]) => (
          <Row key={spec} label={spec} value={reason} />
        ))}
        {overlay.dispatchSummary ? (
          <pre className="cx-cockpit-pre">{overlay.dispatchSummary}</pre>
        ) : null}
      </DockSection>

      <DockSection title="contracts">
        {(overlay.contractChain || []).map((edge) => (
          <Row
            key={edge.id || `${edge.producer}-${edge.consumer}`}
            label={edge.producer}
            value={`→ ${edge.consumer}${edge.stage ? ` (${edge.stage})` : ''}`}
          />
        ))}
      </DockSection>

      <DockSection title="gates">
        {overlay.externalResearch?.required ? (
          <Row
            label="research"
            value={`required${overlay.externalResearch.shape ? ` (${overlay.externalResearch.shape})` : ''}`}
            accent
          />
        ) : null}
        {overlay.framingChallenge?.required ? (
          <Row label="framing" value="challenge required" accent />
        ) : null}
        {overlay.docAuthoring?.docType ? (
          <Row
            label="doc"
            value={`${overlay.docAuthoring.docType} → ${overlay.docAuthoring.owner || 'unknown'}`}
          />
        ) : null}
        {overlay.artifactReview?.requiredReviewers?.length ? (
          <Row label="reviewers" value={overlay.artifactReview.requiredReviewers.join(', ')} />
        ) : null}
      </DockSection>

      {overlay.workingBranch ? (
        <DockSection title="branch">
          <Row label="git" value={overlay.workingBranch} />
        </DockSection>
      ) : null}
    </aside>
  );
}
