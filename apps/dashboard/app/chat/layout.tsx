/**
 * Chat route layout — applies immersive terminal shell class on mount.
 */

'use client';

import { useEffect, type ReactNode } from 'react';

export default function ChatLayout({ children }: { children: ReactNode }) {
  useEffect(() => {
    const shell = document.querySelector('.shell');
    shell?.classList.add('shell--chat');
    return () => shell?.classList.remove('shell--chat');
  }, []);

  return children;
}
