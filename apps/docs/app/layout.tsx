import { RootProvider } from 'fumadocs-ui/provider';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import type { ReactNode } from 'react';
import 'fumadocs-ui/style.css';
import './theme.css';

export const metadata = {
  title: { default: 'Construct', template: '%s | Construct' },
  description: 'One AI interface. 28 specialists. Hard gates. Runs locally or deploys for teams.',
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
