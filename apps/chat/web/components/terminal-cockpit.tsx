/**
 * apps/chat/web/components/terminal-cockpit.tsx — web port of construct chat Ink cockpit.
 */

'use client';

import { useEffect, useState } from 'react';
import { useChatStream } from '../hooks/use-chat-stream';
import { StatusBar } from './status-bar';
import { EventLog } from './event-log';
import { SessionDock } from './session-dock';
import { CliPrompt } from './cli-prompt';
import { ListPicker } from './list-picker';

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
    picker,
    setPicker,
    sendMessage,
    resolvePermission,
    toggleLayer,
    handlePickerSelect,
  } = useChatStream();

  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  return (
    <div className="cx-cockpit" data-testid="terminal-cockpit">
      {error ? (
        <p role="alert" className="cx-cockpit-error-banner">{error}</p>
      ) : null}

      <StatusBar
        sessionMeta={sessionMeta}
        layers={layers}
        streaming={streaming}
        onToggleLayer={toggleLayer}
      />

      <div className="cx-cockpit-main">
        <EventLog turns={turns} layers={layers} sessionMeta={sessionMeta} />

        <div className={`cx-cockpit-rail-col ${mobile && routeDrawerOpen ? 'cx-cockpit-rail-open' : ''}`}>
          {mobile ? (
            <button
              type="button"
              className="cx-cockpit-rail-toggle"
              onClick={() => setRouteDrawerOpen((v) => !v)}
            >
              {routeDrawerOpen ? 'hide session' : 'session rail'}
            </button>
          ) : null}
          <SessionDock
            sessionMeta={sessionMeta}
            layers={layers}
            overlay={activeOverlay}
            streaming={streaming}
            onToggleLayer={toggleLayer}
          />
        </div>
      </div>

      {picker ? (
        <ListPicker
          title={picker.title}
          items={picker.items}
          selectedId={picker.selectedId}
          onSelect={handlePickerSelect}
          onCancel={() => setPicker(null)}
        />
      ) : null}

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

      <CliPrompt disabled={streaming || Boolean(picker)} onSubmit={(text) => void sendMessage(text)} />
    </div>
  );
}
