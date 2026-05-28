/**
 * sync-grid.tsx — Registry → construct sync → editors fan-out visualization.
 *
 * Shows how one canonical source distributes to multiple editor targets via
 * construct sync. Used in docs/start/connect-your-editor.mdx.
 *
 * adapter type determines the color badge:
 *   full   = green  (complete agent adapters)
 *   prompt = blue   (prompt profiles only)
 *   mcp    = purple (MCP registrations only)
 */

export interface SyncTarget {
  name: string;
  path: string;
  type: 'full' | 'prompt' | 'mcp';
}

interface SyncGridProps {
  targets: SyncTarget[];
}

const BADGE: Record<SyncTarget['type'], { label: string; cls: string }> = {
  full: {
    label: 'full adapter',
    cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
  prompt: {
    label: 'prompt profiles',
    cls: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400',
  },
  mcp: {
    label: 'mcp only',
    cls: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400',
  },
};

export function SyncGrid({ targets }: SyncGridProps) {
  return (
    <div className="not-prose my-8 flex flex-col items-center gap-4">
      {/* Source */}
      <div className="rounded-xl border border-fd-border bg-fd-card px-6 py-4 text-center shadow-sm">
        <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-fd-muted-foreground">
          canonical source
        </p>
        <p className="font-mono text-sm font-bold text-fd-foreground">specialists/registry.json</p>
        <p className="mt-0.5 text-xs text-fd-muted-foreground">one source of truth for all 28 specialists</p>
      </div>

      {/* Down arrow */}
      <div className="flex flex-col items-center gap-1">
        <div className="h-5 w-px bg-fd-border" />
        <div className="rounded-lg border border-fd-primary/50 bg-fd-primary/8 px-5 py-2.5 text-center shadow-sm shadow-fd-primary/10">
          <p className="font-mono text-sm font-semibold text-fd-primary">construct sync</p>
        </div>
        <div className="h-5 w-px bg-fd-border" />
      </div>

      {/* Targets grid */}
      <div className="grid w-full max-w-2xl grid-cols-2 gap-3 sm:grid-cols-3">
        {targets.map((t) => {
          const badge = BADGE[t.type];
          return (
            <div
              key={t.name}
              className="flex flex-col gap-2 rounded-xl border border-fd-border bg-fd-card p-4 transition-colors hover:bg-fd-muted/30"
            >
              <p className="text-sm font-semibold text-fd-foreground">{t.name}</p>
              <p className="font-mono text-[10px] leading-relaxed text-fd-muted-foreground break-all">
                {t.path}
              </p>
              <span
                className={[
                  'mt-auto w-fit rounded-full border px-2 py-0.5 font-mono text-[10px]',
                  badge.cls,
                ].join(' ')}
              >
                {badge.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
