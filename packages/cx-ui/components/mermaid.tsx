/**
 * Mermaid diagram renderer + framed container. Lazy-imports mermaid only
 * client-side to keep the static export tree small. Re-renders on theme
 * change so light/dark palettes stay in sync with the rest of the chrome.
 */

'use client';

import { useEffect, useRef, useState } from 'react';

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
            fontFamily: 'Geist, ui-sans-serif, system-ui',
            fontSize: '13px',
          },
          flowchart: { curve: 'basis', padding: 14 },
          securityLevel: 'loose',
        });
        const renderId = `${id}-svg`;
        const { svg } = await mermaid.render(renderId, chart);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
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
