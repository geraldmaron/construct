/**
 * apps/chat/web/components/terminal-cockpit.tsx — full-height terminal cockpit shell.
 *
 * Status bar, event log, route dock, session dock, and CLI prompt for dashboard /chat.
 */

'use client';

import { useEffect, useState } from 'react';
import { useChatStream } from '../hooks/use-chat-stream';
import { StatusBar } from './status-bar';
import { EventLog } from './event-log';
import { RouteDock } from './route-dock';
import { SessionDock } from './session-dock';
import { CliPrompt } from './cli-prompt';

export function TerminalCockpit() {
  const {
    turns,
    sessionMeta,
    layers,
    activeOverlay,
    pending,
    error,
    streaming,
    routeDrawerOpen,
    setRouteDrawerOpen,
    sendMessage,
    resolvePermission,
    toggleLayer,
  } = useChatStream();

  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const routeCount = activeOverlay?.specialists?.length || 0;
  const turnIndex = turns.length || undefined;

  return (
    <div className="cx-cockpit">
      {error ? (
        <p role="alert" className="cx-cockpit-error-banner">{error}</p>
      ) : null}

      <StatusBar
        sessionMeta={sessionMeta}
        layers={layers}
        streaming={streaming}
        onToggleLayer={toggleLayer}
        showRouteToggle={mobile}
        routeCount={routeCount}
        onToggleRoute={() => setRouteDrawerOpen((v) => !v)}
      />

      <div className="cx-cockpit-main">
        <EventLog turns={turns} layers={layers} />

        <div className={`cx-cockpit-dock-col ${mobile && routeDrawerOpen ? 'cx-cockpit-dock-open' : ''}`}>
          <RouteDock overlay={activeOverlay} turnIndex={turnIndex} />
          <SessionDock sessionMeta={sessionMeta} />
        </div>
      </div>

      {pending ? (
        <div className="cx-cockpit-permission" role="dialog" aria-label="Permission request">
          <strong>Permission:</strong>
          {' '}
          {pending.title}
          <div className="cx-cockpit-permission-actions">
            {pending.options.map((opt) => (
              <button key={opt} type="button" onClick={() => void resolvePermission(opt)}>
                {opt}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <CliPrompt disabled={streaming} onSubmit={(text) => void sendMessage(text)} />
    </div>
  );
}
