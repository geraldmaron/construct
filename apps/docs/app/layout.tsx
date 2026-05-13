import { RootProvider } from 'fumadocs-ui/provider';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import 'fumadocs-ui/style.css';

const inter = Inter({
  subsets: ['latin'],
});

export const metadata = {
  title: { default: 'Construct', template: '%s | Construct' },
  description: 'Orchestration layer behind an agentic software organization. One AI interface, 28 specialists, hard gates, local-first.',
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
