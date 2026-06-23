/**
 * Dashboard route — terminal cockpit for owned-loop web chat at /chat.
 */
'use client';

import '../../../chat/web/theme/tokens.css';
import { TerminalCockpit } from '../../../chat/web/components/terminal-cockpit';

export default function ChatPage() {
  return <TerminalCockpit />;
}
