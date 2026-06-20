/**
 * apps/dashboard/app/chat/chat-shell.tsx — immersive /chat shell wrapper.
 *
 * Applies shell--chat on mount, hosts next/font CSS variables, and marks
 * ?surface=desktop for the Tauri window (no dashboard chrome).
 */

'use client';

import { useEffect, type ReactNode } from 'react';

type ChatShellProps = {
  children: ReactNode;
  className?: string;
};

function isDesktopSurface() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('surface') === 'desktop';
}

export function ChatShell({ children, className }: ChatShellProps) {
  useEffect(() => {
    const shell = document.querySelector('.shell');
    shell?.classList.add('shell--chat');
    if (isDesktopSurface()) {
      document.documentElement.dataset.chatSurface = 'desktop';
      shell?.classList.add('shell--chat-desktop');
    }
    return () => {
      shell?.classList.remove('shell--chat', 'shell--chat-desktop');
      delete document.documentElement.dataset.chatSurface;
    };
  }, []);

  return (
    <div className={className} style={{ display: 'contents' }}>
      {children}
    </div>
  );
}
