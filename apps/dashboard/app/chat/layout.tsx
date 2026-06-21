/**
 * Chat route layout — Space Grotesk / JetBrains Mono and immersive shell.
 */

import type { ReactNode } from 'react';
import { JetBrains_Mono, Space_Grotesk } from 'next/font/google';
import { ChatShell } from './chat-shell';

const chatSans = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-chat-sans',
  display: 'swap',
});

const chatMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-chat-mono',
  display: 'swap',
});

export default function ChatLayout({ children }: { children: ReactNode }) {
  return (
    <ChatShell className={`${chatSans.variable} ${chatMono.variable}`}>
      {children}
    </ChatShell>
  );
}
