/**
 * apps/chat/web/components/cli-prompt.tsx — shell-style input for terminal cockpit.
 */

'use client';

import { FormEvent, KeyboardEvent, useState } from 'react';

type CliPromptProps = {
  disabled: boolean;
  onSubmit: (text: string) => void;
};

export function CliPrompt({ disabled, onSubmit }: CliPromptProps) {
  const [input, setInput] = useState('');

  const submit = () => {
    const text = input.trim();
    if (!text || disabled) return;
    setInput('');
    onSubmit(text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const onFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };

  return (
    <form className="cx-cockpit-prompt" onSubmit={onFormSubmit} aria-label="Construct prompt">
      <label htmlFor="construct-prompt" className="cx-cockpit-prompt-glyph">construct ›</label>
      <textarea
        id="construct-prompt"
        className="cx-cockpit-prompt-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        rows={1}
        placeholder="Message or /clear …"
        aria-label="Message construct"
      />
      <span className="cx-cockpit-prompt-hints cx-cockpit-muted">/clear · Shift+Enter newline</span>
    </form>
  );
}
