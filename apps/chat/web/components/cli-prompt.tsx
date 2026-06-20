/**
 * apps/chat/web/components/cli-prompt.tsx — shell-style input for terminal cockpit.
 *
 * Tab completion, input history, and slash-command ghost hints match Ink Footer.
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

type CliPromptProps = {
  disabled: boolean;
  pickerActive?: boolean;
  onSubmit: (text: string) => void;
};

export function CliPrompt({ disabled, pickerActive = false, onSubmit }: CliPromptProps) {
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

  if (pickerActive) {
    return (
      <footer className="cx-cockpit-footer cx-cockpit-footer-picker" aria-label="Picker active">
        <hr className="cx-cockpit-rule" />
        <div className="cx-cockpit-prompt-line">
          <span className="cx-cockpit-prompt-glyph">pick ▸</span>
          <span className="cx-cockpit-muted">use the picker above — type to filter, ↑/↓ move, enter select, esc cancel</span>
        </div>
      </footer>
    );
  }

  return (
    <footer className="cx-cockpit-footer" aria-label="Construct prompt">
      <hr className="cx-cockpit-rule" />
      {suggestHint ? (
        <p className="cx-cockpit-muted cx-cockpit-prompt-suggest">{`tab complete   ${suggestHint}`}</p>
      ) : null}
      <form onSubmit={onFormSubmit}>
        <div className="cx-cockpit-prompt-line">
          <label htmlFor="construct-prompt" className="cx-cockpit-prompt-glyph">you ▸</label>
          <textarea
            id="construct-prompt"
            className="cx-cockpit-prompt-input"
            value={input}
            onChange={(e) => {
              historyPos.current = -1;
              setInput(e.target.value);
            }}
            onKeyDown={onKeyDown}
            disabled={disabled}
            rows={1}
            placeholder=""
            aria-label="Message construct"
          />
          {!disabled && !input ? (
            <span className="cx-cockpit-cursor" aria-hidden>▌</span>
          ) : null}
          {ghost ? (
            <span className="cx-cockpit-muted cx-cockpit-prompt-ghost-inline" aria-hidden>{ghost}</span>
          ) : null}
        </div>
        <p className="cx-cockpit-prompt-hints cx-cockpit-muted">
          enter send   tab complete   shift+enter newline   m model   , settings   esc cancel stream
        </p>
      </form>
    </footer>
  );
}
