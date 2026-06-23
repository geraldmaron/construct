/**
 * Command-palette source-of-truth. The sidebar is built dynamically from
 * docs/ at build time (see `lib/docs-source.ts#buildSidebar`); the palette
 * carries a curated subset of pages + CLI commands users frequently search
 * for, with one mono-glyph each so the UI stays aligned with the design.
 */

export type PaletteItem = {
  kind: 'page' | 'cmd' | 'tip';
  title: string;
  sub: string;
  glyph: string;
  href?: string;
};

export const PALETTE: PaletteItem[] = [
  { kind: 'page', title: 'Home', sub: '/', href: '/', glyph: 'H' },
  { kind: 'page', title: 'Get started', sub: 'install · init · first task', href: '/start', glyph: 'S' },
  { kind: 'page', title: 'Architecture', sub: 'diagrams · gates · contracts', href: '/concepts/architecture', glyph: 'A' },
  { kind: 'page', title: 'Deployment model', sub: 'solo · team · enterprise', href: '/concepts/deployment-model', glyph: 'D' },
  { kind: 'page', title: 'Intake and triage', sub: '.cx/inbox/ → triage → agent', href: '/concepts/intake-and-triage', glyph: 'I' },
  { kind: 'page', title: 'Cookbook', sub: 'recipes by job-to-be-done', href: '/cookbook', glyph: 'C' },
  { kind: 'page', title: 'Reference', sub: 'CLI · hooks · MCP · config', href: '/reference', glyph: 'R' },
  { kind: 'page', title: 'Release and deploy', sub: 'tag pipeline · Pages · npm', href: '/maintenance/release-and-deploy', glyph: 'M' },
  { kind: 'page', title: 'Contributing', sub: 'PR gates · hooks · tests', href: '/contributing', glyph: 'G' },
  { kind: 'page', title: 'ADR-0039 Surface model', sub: 'interaction surface tiers', href: '/adr/0039-interaction-surface-model', glyph: 'A' },
  { kind: 'cmd', title: 'construct init', sub: 'scaffold a project', glyph: '$' },
  { kind: 'cmd', title: 'construct sync', sub: 'refresh host adapters', glyph: '$' },
  { kind: 'cmd', title: 'construct status', sub: 'runtime health', glyph: '$' },
  { kind: 'cmd', title: 'construct doctor', sub: 'installation checks', glyph: '$' },
  { kind: 'cmd', title: 'construct intake list', sub: 'pending signals', glyph: '$' },
  { kind: 'cmd', title: 'construct config mode', sub: 'solo | team | enterprise', glyph: '$' },
  { kind: 'tip', title: 'Toggle density', sub: 'header → compact/comfortable', glyph: '⌥' },
  { kind: 'tip', title: 'Switch theme', sub: 'header → sun/moon', glyph: '⌥' },
];
