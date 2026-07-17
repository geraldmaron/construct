/**
 * Mermaid diagram renderer + framed container. Lazy-imports mermaid only
 * client-side to keep the static export tree small. Re-renders on theme
 * change so light/dark palettes stay in sync with the rest of the chrome.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import {
  MERMAID_CHART_SIZE_LIMIT,
  MERMAID_RENDER_TIMEOUT_MS,
  isChartOversized,
  sanitizeMermaidSvg,
  withTimeout,
} from './mermaid-sanitize';

type MermaidProps = {
  id: string;
  chart: string;
  theme: 'dark' | 'light';
};

export function Mermaid({ id, chart, theme }: MermaidProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // A pathological chart string can hang the layout engine on the client
      // thread. Reject above the cap before touching mermaid.render at all,
      // so the cost of a runaway diagram is bounded to a string-length check.
      if (isChartOversized(chart)) {
        if (!cancelled) setError(`diagram source exceeds ${MERMAID_CHART_SIZE_LIMIT} characters`);
        return;
      }
      try {
        const mermaid = (await import('mermaid')).default;
        const palette = theme === 'light'
          ? { bg: '#fafaf9', txt: '#0a0a0a', line: '#bbb', node: '#ffffff', border: '#0a0a0a' }
          : { bg: '#050505', txt: '#f4f4f4', line: '#3a3a3a', node: '#0e0e0e', border: '#f4f4f4' };
        mermaid.initialize({
          startOnLoad: false,
          theme: 'base',
          themeVariables: {
            background: palette.bg,
            primaryColor: palette.node,
            primaryTextColor: palette.txt,
            primaryBorderColor: palette.border,
            lineColor: palette.line,
            secondaryColor: palette.node,
            tertiaryColor: palette.node,
            fontFamily: 'Space Grotesk, ui-sans-serif, system-ui',
            fontSize: '13px',
          },
          flowchart: { curve: 'basis', padding: 14 },
          securityLevel: 'strict',
        });
        const renderId = `${id}-svg`;
        // Mermaid's own `strict` mode is the primary defense; the render
        // call is still raced against a bounded timeout so a hung layout
        // (adversarial input the size cap didn't catch) lands in the error
        // state instead of leaving the component pending indefinitely.
        const { svg } = await withTimeout(mermaid.render(renderId, chart), MERMAID_RENDER_TIMEOUT_MS);
        // Defense in depth on top of `strict`: neutralize any script,
        // event-handler, foreignObject, or javascript:/data: URL that
        // survives into the rendered SVG string before it is ever assigned
        // to innerHTML.
        const safeSvg = sanitizeMermaidSvg(svg);
        if (!cancelled && ref.current) ref.current.innerHTML = safeSvg;
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'render failed');
      }
    })();
    return () => { cancelled = true; };
  }, [chart, theme, id]);

  if (error) return <div className="mermaid" style={{ color: 'var(--muted)' }}>Diagram error: {error}</div>;
  return <div className="mermaid" ref={ref} />;
}

type DiagramProps = {
  id: string;
  title: string;
  chart: string;
  theme: 'dark' | 'light';
};

export function Diagram({ id, title, chart, theme }: DiagramProps) {
  return (
    <div className="diagram">
      <div className="dh">
        <span>{title}</span>
      </div>
      <div className="db">
        <Mermaid id={id} chart={chart} theme={theme} />
      </div>
    </div>
  );
}
