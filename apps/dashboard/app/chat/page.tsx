/** Dashboard route — owned-loop web chat at /chat. */
'use client';

import '../../../chat/web/theme/tokens.css';
import { ChatLayout } from '../../../chat/web/components/chat-layout';
import { Page } from '@/components/page';

export default function ChatPage() {
  return (
    <Page
      eyebrow="agent · owned loop"
      title="Chat"
      lede="Browser surface for construct chat — Geist typography, streaming driver events, inspector dock for routing and tools."
    >
      <ChatLayout />
    </Page>
  );
}
