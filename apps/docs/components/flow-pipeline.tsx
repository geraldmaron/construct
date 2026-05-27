/**
 * flow-pipeline.tsx — Horizontal step-by-step pipeline visualization.
 *
 * Renders labeled nodes with connecting arrows. Steps can carry a badge
 * (mono eyebrow), sublabel, via-label on the preceding arrow, and a
 * highlight accent for terminal/key nodes.
 *
 * Usage in MDX (no import needed — registered globally):
 *   <FlowPipeline steps={[
 *     { label: 'npm install', badge: 'once', sub: '@geraldmaron/construct' },
 *     { label: 'construct init', sub: 'config · Postgres · completions' },
 *     { label: 'construct sync', sub: 'editor adapters', highlight: true },
 *   ]} />
 */

export interface PipelineStep {
  label: string;
  sub?: string;
  badge?: string;
  via?: string;
  highlight?: boolean;
}

interface FlowPipelineProps {
  steps: PipelineStep[];
  vertical?: boolean;
}

export function FlowPipeline({ steps, vertical = false }: FlowPipelineProps) {
  return (
    <div
      className={[
        'not-prose my-8 flex items-start gap-1',
        vertical ? 'flex-col' : 'flex-col sm:flex-row sm:flex-wrap sm:items-stretch',
      ].join(' ')}
    >
      {steps.map((step, i) => (
        <div
          key={i}
          className={[
            'flex items-center gap-1',
            vertical ? 'flex-row' : 'flex-row sm:contents',
          ].join(' ')}
        >
          {/* Connector arrow (not before first step) */}
          {i > 0 && (
            <div className="flex shrink-0 flex-col items-center gap-0.5">
              {step.via && (
                <span className="rounded-full border border-fd-border bg-fd-muted/60 px-2 py-0.5 font-mono text-[10px] text-fd-muted-foreground">
                  {step.via}
                </span>
              )}
              <span
                className={[
                  'select-none font-light text-fd-muted-foreground',
                  vertical ? 'rotate-90 text-base' : 'text-lg',
                ].join(' ')}
              >
                →
              </span>
            </div>
          )}

          {/* Step node */}
          <div
            className={[
              'flex min-w-[120px] flex-1 flex-col gap-1 rounded-xl border p-4 transition-colors',
              step.highlight
                ? 'border-fd-primary/50 bg-fd-primary/8 shadow-sm shadow-fd-primary/10'
                : 'border-fd-border bg-fd-card hover:bg-fd-muted/30',
            ].join(' ')}
          >
            {step.badge && (
              <span className="w-fit rounded-full border border-fd-border bg-fd-muted/50 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-fd-muted-foreground">
                {step.badge}
              </span>
            )}
            <span
              className={[
                'text-sm font-semibold leading-snug',
                step.highlight ? 'text-fd-primary' : 'text-fd-foreground',
              ].join(' ')}
            >
              {step.label}
            </span>
            {step.sub && (
              <span className="text-xs leading-relaxed text-fd-muted-foreground">
                {step.sub}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
