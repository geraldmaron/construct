/**
 * request-flow.tsx — Vertical request lifecycle diagram.
 *
 * Renders a sequence of labeled nodes connected by arrows. Decision nodes
 * render with an amber accent to visually distinguish gate/check points.
 * The exit label appears on the arrow leaving a decision node.
 *
 * Usage in MDX (no import needed — registered globally):
 *   <RequestFlow nodes={[
 *     { label: 'User request' },
 *     { label: 'Gates', decision: true, exitLabel: 'pass' },
 *     { label: 'Result', highlight: true },
 *   ]} />
 */

export interface FlowNode {
  label: string;
  sub?: string;
  decision?: boolean;
  exitLabel?: string;
  highlight?: boolean;
}

interface RequestFlowProps {
  nodes: FlowNode[];
}

export function RequestFlow({ nodes }: RequestFlowProps) {
  return (
    <div className="not-prose my-8 flex flex-col items-center">
      {nodes.map((node, i) => (
        <div key={i} className="flex w-full max-w-sm flex-col items-center">
          {/* Node */}
          <div
            className={[
              'w-full rounded-xl border px-5 py-3.5 text-center transition-colors',
              node.highlight
                ? 'border-fd-primary/50 bg-fd-primary/8 shadow-sm shadow-fd-primary/10'
                : node.decision
                  ? 'border-amber-500/40 bg-amber-500/8'
                  : 'border-fd-border bg-fd-card',
            ].join(' ')}
          >
            {node.decision && (
              <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-amber-600 dark:text-amber-500">
                gate / check
              </p>
            )}
            <p
              className={[
                'text-sm font-semibold leading-snug',
                node.highlight
                  ? 'text-fd-primary'
                  : node.decision
                    ? 'text-amber-800 dark:text-amber-200'
                    : 'text-fd-foreground',
              ].join(' ')}
            >
              {node.label}
            </p>
            {node.sub && (
              <p className="mt-1 text-xs leading-relaxed text-fd-muted-foreground">{node.sub}</p>
            )}
          </div>

          {/* Connector */}
          {i < nodes.length - 1 && (
            <div className="flex flex-col items-center gap-0.5 py-1">
              <div className="h-3 w-px bg-fd-border" />
              {node.exitLabel && (
                <span className="rounded-full border border-fd-border bg-fd-muted/60 px-2 py-0.5 font-mono text-[10px] text-fd-muted-foreground">
                  {node.exitLabel}
                </span>
              )}
              <span className="select-none text-sm text-fd-muted-foreground">↓</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
