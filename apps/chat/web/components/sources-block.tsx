/**
 * apps/chat/web/components/sources-block.tsx — collapsible SOURCES section for the metadata rail.
 *
 * Lists the turn's captured references. Renders nothing when the turn cites no
 * sources, so the rail divider never appears for an empty section.
 */

'use client';

type SourcesBlockProps = {
  sources: string[];
  visible: boolean;
};

export function SourcesBlock({ sources, visible }: SourcesBlockProps) {
  if (!visible) return null;
  if (!sources?.length) return null;

  return (
    <details className="cx-rail-section cx-sources-block">
      <summary className="cx-rail-summary">
        <span className="cx-rail-chevron" aria-hidden>›</span>
        <span className="cx-rail-label">SOURCES</span>
        <span className="cx-rail-meta">
          {sources.length} reference{sources.length === 1 ? '' : 's'}
        </span>
      </summary>
      <div className="cx-rail-detail cx-sources-list">
        {sources.map((src, i) => (
          <div key={`${src}-${i}`} className="cx-sources-item">{src}</div>
        ))}
      </div>
    </details>
  );
}
