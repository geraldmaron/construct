/**
 * Server entry to the docs shell. Reads the sidebar from docs/ at build time
 * (no client-side fs) and hands the resulting structure to AppShellClient,
 * which owns interactivity (theme, density, command palette, etc.).
 */

import type { ReactNode } from 'react';
import { buildSidebar, SidebarSection } from '@/lib/docs-source';
import { AppShellClient } from './app-shell-client';

export function AppShell({ children }: { children: ReactNode }) {
  const sidebar: SidebarSection[] = buildSidebar();
  return <AppShellClient sidebar={sidebar}>{children}</AppShellClient>;
}
