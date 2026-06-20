/**
 * apps/chat/web/components/cli-prompt.tsx — modern prompt card with session usage strip.
 *
 * Tab completion, input history, and slash-command ghost hints preserved from original.
 * Visual update: rounded input card with top session strip for token totals.
 */

'use client';

import { FormEvent, KeyboardEvent, useRef, useState } from 'react';
import {
  applyTabCompletion,
  commandSuggestHint,
  cycleSlashCommand,
  isSlashOnlyInput,
  slashCommandGhost,
  slashCommandMatches,
} from '../../../../lib/chat/command-suggest.mjs';
import type { SessionMeta } from '../types';
import { SessionUsageFooter } from './session-usage-footer';

type CliPromptProps = {
  disabled: boolean;
  pickerActive?: boolean;
  sessionMeta?: SessionMeta;
  layers?: Record<string, boolean>;
  onSubmit: (text: string) => void;
};

export function CliPrompt({
  disabled,
  pickerActive = false,
  sessionMeta,
  layers,
  onSubmit,
}: CliPromptProps) {
  const [input, setInput] = useState('');
  const inputHistory = useRef<string[]>([]);
  const historyPos = useRef(-1);

  const submit = () => {
    const text = input.trim();
    if (!text || disabled) return;
    if (!text.startsWith('/')) {
      const hist = inputHistory.current;
      if (!hist.length || hist[hist.length - 1] !== text) hist.push(text);
    }
    historyPos.current = -1;
    setInput('');
    onSubmit(text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      setInput((v) => applyTabCompletion(v));
      return;
    }
    const slashMode = isSlashOnlyInput(input);
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (slashMode && slashCommandMatches(input).length > 1) {
        setInput((v) => cycleSlashCommand(v, -1));
        return;
      }
      const hist = inputHistory.current;
      if (!hist.length) return;
      const next = historyPos.current < 0 ? hist.length - 1 : Math.max(0, historyPos.current - 1);
      historyPos.current = next;
      setInput(hist[next]);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (slashMode && slashCommandMatches(input).length > 1) {
        setInput((v) => cycleSlashCommand(v, 1));
        return;
      }
      const hist = inputHistory.current;
      if (!hist.length || historyPos.current < 0) return;
      const next = historyPos.current + 1;
      if (next >= hist.length) {
        historyPos.current = -1;
        setInput('');
        return;
      }
      historyPos.current = next;
      setInput(hist[next]);
    }
  };

  const onFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };

  const ghost = slashCommandGhost(input);
  const suggestHint = commandSuggestHint(input);
  const showObservability = layers?.observability !== false;

  return (
    <footer className="cx-cockpit-footer" aria-label="Construct prompt">
      {sessionMeta && (
        <SessionUsageFooter sessionMeta={sessionMeta} visible={showObservability} />
      )}

      <div className="cx-cockpit-footer-inner">
        {pickerActive ? (
          <div className="cx-prompt-card-picker">
            <span className="cx-cockpit-muted">
              Picker active — type to filter, ↑/↓ navigate, enter select, esc cancel
            </span>
          </div>
        ) : (
          <form onSubmit={onFormSubmit}>
            {suggestHint && (
              <p className="cx-prompt-card-suggest">{`tab complete   ${suggestHint}`}</p>
            )}
            <div className="cx-prompt-card">
              <div className="cx-prompt-card-row">
                <textarea
                  id="construct-prompt"
                  className="cx-prompt-card-input"
                  value={input}
                  onChange={(e) => {
                    historyPos.current = -1;
                    setInput(e.target.value);
                  }}
                  onKeyDown={onKeyDown}
                  disabled={disabled}
                  rows={1}
                  placeholder={disabled ? 'working…' : 'Ask Construct anything…'}
                  aria-label="Message construct"
                />
                {ghost && (
                  <span className="cx-prompt-card-ghost cx-cockpit-muted" aria-hidden>{ghost}</span>
                )}
              </div>
              <p className="cx-prompt-card-hints">
                <span>↵ send</span>
                <span>⇥ complete</span>
                <span>⇧↵ newline</span>
                <span>m model</span>
                <span>, settings</span>
                <span>esc cancel</span>
              </p>
            </div>
          </form>
        )}
      </div>
    </footer>
  );
}
