/**
 * Dashboard chrome. Hands the static NAV to AppShellClient; the client owns
 * route-active state and runtime preferences (theme/density/motion/calm).
 */

import type { ReactNode } from 'react';
import { AppShellClient } from './app-shell-client';
import { NAV } from './nav-data';

export function AppShell({ children }: { children: ReactNode }) {
  return <AppShellClient nav={NAV}>{children}</AppShellClient>;
}
