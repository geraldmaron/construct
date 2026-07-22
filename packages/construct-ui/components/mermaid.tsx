/**
 * Mermaid diagram renderer + framed container. Lazy-imports mermaid only
 * client-side to keep the static export tree small. Re-renders on theme
 * change so light/dark palettes stay in sync with the rest of the chrome.
 *
 * Hardened defaults (construct-tsyfe.4.2): strict securityLevel, sanitized SVG
 * mount, size/timeout guards, deterministic handDrawn seed, and Diagram Card
 * metadata on the rendered container.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import {
  MERMAID_DEGRADED_TIMEOUT,
  MERMAID_DEGRADED_TOO_LARGE,
  MERMAID_PINNED_VERSION,
  assessMermaidSource,
  buildInteractiveMermaidDiagramCard,
  buildMermaidInitializeConfig,
  sanitizeMermaidSvg,
  withRenderTimeout,
} from '../mermaid-interactive.mjs';

type MermaidProps = {
  id: string;
  chart: string;
  theme: 'dark' | 'light';
  look?: 'classic' | 'handDrawn';
  accessibilityDescription: string;
};

function mountSanitizedSvg(container: HTMLDivElement, svg: string) {
  const safe = sanitizeMermaidSvg(svg);
  const doc = new DOMParser().parseFromString(safe, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.nodeName.toLowerCase() === 'parsererror') {
    throw new Error('invalid mermaid svg');
  }
  container.replaceChildren();
  container.appendChild(document.importNode(root, true));
}

export function Mermaid({
  id,
  chart,
  theme,
  look = 'classic',
  accessibilityDescription,
}: MermaidProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const assessment = assessMermaidSource(chart);
        if (!assessment.ok) {
          if (!cancelled) setError(MERMAID_DEGRADED_TOO_LARGE);
          return;
        }
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize(buildMermaidInitializeConfig({ theme, look }));
        const renderId = `${id}-svg`;
        const { svg } = await withRenderTimeout(mermaid.render(renderId, chart));
        if (cancelled || !ref.current) return;
        mountSanitizedSvg(ref.current, svg);
        const card = buildInteractiveMermaidDiagramCard({
          id,
          chart,
          theme,
          look,
          engineVersion: MERMAID_PINNED_VERSION,
          accessibilityDescription,
        });
        ref.current.dataset.diagramCard = JSON.stringify(card);
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'render failed';
          setError(message === MERMAID_DEGRADED_TIMEOUT ? MERMAID_DEGRADED_TIMEOUT : message);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [accessibilityDescription, chart, id, look, theme]);

  if (error) {
    return (
      <div className="mermaid" role="img" aria-label={accessibilityDescription} style={{ color: 'var(--muted)' }}>
        Diagram error: {error}
      </div>
    );
  }
  return (
    <div
      className="mermaid"
      ref={ref}
      role="img"
      aria-label={accessibilityDescription}
    />
  );
}

type DiagramProps = {
  id: string;
  title: string;
  chart: string;
  theme: 'dark' | 'light';
  look?: 'classic' | 'handDrawn';
};

export function Diagram({ id, title, chart, theme, look = 'classic' }: DiagramProps) {
  return (
    <div className="diagram">
      <div className="dh">
        <span>{title}</span>
      </div>
      <div
        className="db"
        role="region"
        aria-label={title}
        tabIndex={0}
      >
        <Mermaid
          id={id}
          chart={chart}
          theme={theme}
          look={look}
          accessibilityDescription={title}
        />
      </div>
    </div>
  );
}
