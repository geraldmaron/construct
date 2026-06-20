/**
 * Chat route layout — Plus Jakarta Sans / IBM Plex Mono and immersive shell.
 */

import type { ReactNode } from 'react';
import { IBM_Plex_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import { ChatShell } from './chat-shell';

const chatSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-chat-sans',
  display: 'swap',
});

const chatMono = IBM_Plex_Mono({
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
