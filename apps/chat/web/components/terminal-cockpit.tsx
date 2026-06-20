/**
 * apps/chat/web/components/terminal-cockpit.tsx — Construct chat cockpit for web and desktop window.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useChatStream, LAYER_KEYS, type LayerKey } from '../hooks/use-chat-stream';
import { StatusBar } from './status-bar';
import { EventLog } from './event-log';
import { SessionDock } from './session-dock';
import { CliPrompt } from './cli-prompt';
import { ListPicker } from './list-picker';

const PERMISSION_KEYS: Record<string, string> = {
  y: 'allow',
  a: 'allow_always',
  n: 'reject',
};

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
    cancelStream,
    openModelPicker,
    openSettingsPicker,
  } = useChatStream();

  const [mobile, setMobile] = useState(false);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const onGlobalKeyDown = useCallback((event: KeyboardEvent) => {
    if (picker) return;
    const target = event.target as HTMLElement | null;
    const inPrompt = target?.closest('.cx-cockpit-prompt') != null;

    if (pending && !inPrompt) {
      const decision = PERMISSION_KEYS[event.key];
      if (decision) {
        event.preventDefault();
        void resolvePermission(decision);
        return;
      }
    }

    if (event.ctrlKey && !event.metaKey && !event.altKey && !inPrompt) {
      const layerIndex = Number.parseInt(event.key, 10);
      if (layerIndex >= 1 && layerIndex <= LAYER_KEYS.length) {
        event.preventDefault();
        void toggleLayer(LAYER_KEYS[layerIndex - 1] as LayerKey);
      }
    }

    if (event.key === 'Escape' && streaming && !inPrompt) {
      event.preventDefault();
      void cancelStream();
      return;
    }

    if (!inPrompt && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (event.key === 'm' || event.key === 'M') {
        event.preventDefault();
        void openModelPicker();
        return;
      }
      if (event.key === ',') {
        event.preventDefault();
        openSettingsPicker();
      }
    }
  }, [cancelStream, openModelPicker, openSettingsPicker, pending, picker, resolvePermission, streaming, toggleLayer]);

  useEffect(() => {
    window.addEventListener('keydown', onGlobalKeyDown);
    return () => window.removeEventListener('keydown', onGlobalKeyDown);
  }, [onGlobalKeyDown]);

  return (
    <div className="cx-cockpit" data-testid="terminal-cockpit">
      {error ? (
        <p role="alert" className="cx-cockpit-error-banner">{error}</p>
      ) : null}

      <StatusBar
        sessionMeta={sessionMeta}
        streaming={streaming}
        onOpenModelPicker={() => void openModelPicker()}
        onOpenSettingsPicker={openSettingsPicker}
        onToggleInspector={() => setRouteDrawerOpen((v) => !v)}
        inspectorOpen={routeDrawerOpen}
      />

      <div className="cx-cockpit-body">
        <div className="cx-cockpit-main">
          <EventLog
            turns={turns}
            layers={layers}
            sessionMeta={sessionMeta}
            onOpenModelPicker={() => void openModelPicker()}
            onOpenSettingsPicker={openSettingsPicker}
            onSelectTurn={setActiveTurnId}
            activeTurnId={activeTurnId}
          />

          <div className={`cx-cockpit-rail-col ${mobile && routeDrawerOpen ? 'cx-cockpit-rail-open' : ''}`}>
            <SessionDock
              sessionMeta={sessionMeta}
              layers={layers}
              overlay={activeTurnId ? turns.find((t) => t.id === activeTurnId)?.overlay || null : activeOverlay}
              streaming={streaming}
              onToggleLayer={toggleLayer}
              onOpenModelPicker={() => void openModelPicker()}
              onOpenSettingsPicker={openSettingsPicker}
            />
          </div>
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
          <p className="cx-cockpit-muted">y allow · a always · n reject</p>
        </div>
      ) : null}

      <CliPrompt
        disabled={streaming}
        pickerActive={Boolean(picker)}
        onSubmit={(text) => void sendMessage(text)}
      />
    </div>
  );
}
