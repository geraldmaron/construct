/**
 * Dashboard navigation source-of-truth. Sidebar layout mirrors the cognitive
 * groupings users already know from the Vite dashboard (Activity / Work /
 * System / Models / Infra), with each item linking to its Next.js route.
 *
 * The command palette draws from the same data plus a curated set of common
 * CLI commands and tips.
 */

import type { PaletteItem } from '@cx/ui';

export type NavItem = { id: string; title: string; href: string };
export type NavGroup = { label: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { id: 'home', title: 'Home', href: '/' },
      { id: 'doctor', title: 'Doctor', href: '/doctor' },
      { id: 'resources', title: 'Services', href: '/resources' },
    ],
  },
  {
    label: 'Activity',
    items: [
      { id: 'audit', title: 'Audit trail', href: '/audit' },
      { id: 'snapshots', title: 'Snapshots', href: '/snapshots' },
      { id: 'performance', title: 'Performance', href: '/performance' },
    ],
  },
  {
    label: 'Work',
    items: [
      { id: 'chat', title: 'Chat', href: '/chat' },
      { id: 'approvals', title: 'Approvals', href: '/approvals' },
      { id: 'workflow', title: 'Workflow', href: '/workflow' },
      { id: 'beads', title: 'Beads', href: '/beads' },
      { id: 'artifacts', title: 'Artifacts', href: '/artifacts' },
      { id: 'intake', title: 'Intake', href: '/intake' },
    ],
  },
  {
    label: 'Specialists',
    items: [
      { id: 'agents', title: 'Specialists', href: '/agents' },
      { id: 'skills', title: 'Skills', href: '/skills' },
      { id: 'commands', title: 'Slash commands', href: '/commands' },
      { id: 'hooks', title: 'Hooks', href: '/hooks' },
      { id: 'plugins', title: 'Plugins', href: '/plugins' },
    ],
  },
  {
    label: 'Models & Providers',
    items: [
      { id: 'models', title: 'Models', href: '/models' },
      { id: 'providers', title: 'Providers', href: '/providers' },
      { id: 'mcp', title: 'MCP servers', href: '/mcp' },
    ],
  },
  {
    label: 'Knowledge',
    items: [
      { id: 'knowledge', title: 'Knowledge', href: '/knowledge' },
      { id: 'editor', title: 'Editor', href: '/editor' },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'config', title: 'Config', href: '/config' },
      { id: 'infrastructure', title: 'Infrastructure', href: '/infrastructure' },
    ],
  },
];

export const PALETTE: PaletteItem[] = [
  { kind: 'page', title: 'Home', sub: '/', href: '/', glyph: 'H' },
  { kind: 'page', title: 'Doctor', sub: 'system diagnostics', href: '/doctor', glyph: 'D' },
  { kind: 'page', title: 'Chat', sub: 'owned-loop agent', href: '/chat', glyph: 'C' },
  { kind: 'page', title: 'Approvals', sub: 'pending approval queue', href: '/approvals', glyph: 'A' },
  { kind: 'page', title: 'Models', sub: 'tier + provider config', href: '/models', glyph: 'M' },
  { kind: 'page', title: 'Knowledge', sub: 'ask the corpus', href: '/knowledge', glyph: 'K' },
  { kind: 'page', title: 'Audit', sub: 'tamper-evident trail', href: '/audit', glyph: 'L' },
  { kind: 'page', title: 'Specialists', sub: 'agent overrides', href: '/agents', glyph: 'S' },
  { kind: 'cmd', title: 'construct status', sub: 'runtime health', glyph: '$' },
  { kind: 'cmd', title: 'construct doctor', sub: 'installation checks', glyph: '$' },
  { kind: 'cmd', title: 'construct sync', sub: 'refresh host adapters', glyph: '$' },
  { kind: 'cmd', title: 'construct intake list', sub: 'pending signals', glyph: '$' },
  { kind: 'tip', title: 'Toggle theme', sub: 'header → sun/moon', glyph: '⌥' },
  { kind: 'tip', title: 'Toggle density', sub: 'header → compact/comfortable', glyph: '⌥' },
];
