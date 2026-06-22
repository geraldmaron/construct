/**
 * Root layout for the Construct docs site.
 *
 * Loads Space Grotesk (sans + display) and JetBrains Mono via next/font/google
 * so they're inlined as CSS variables that theme.css consumes. AppShell renders
 * the topbar + sidebar + main grid and owns runtime theme/density/motion
 * state.
 */

import type { ReactNode } from 'react';
import { Space_Grotesk, JetBrains_Mono } from 'next/font/google';
import './theme.css';
import { AppShell } from '@/components/app-shell';

const sans = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

const display = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata = {
  title: { default: 'Construct — Docs', template: '%s | Construct' },
  description:
    'Construct is the orchestration layer behind an agentic software org. One AI interface, a team of specialists behind it.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      data-density="comfortable"
      data-motion="normal"
      suppressHydrationWarning
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
    >
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
