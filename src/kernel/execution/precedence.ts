/**
 * kernel/execution/precedence.ts — explicit executor resolution order.
 *
 * 1. explicit per-request override
 * 2. explicit run-level pin
 * 3. explicit project execution policy
 * 4. active interactive session
 * 5. explicit headless default
 * 6. headless resource selection (never from interactive path)
 */

export type ExecutorSource =
  | 'request-override'
  | 'run-pin'
  | 'project-policy'
  | 'active-interactive-session'
  | 'headless-default'
  | 'headless-resource-selection';

export interface ExecutorResolution {
  readonly executor: string;
  readonly source: ExecutorSource;
  readonly interactive: boolean;
}

export interface PrecedenceInput {
  readonly requestOverride?: string;
  readonly runPin?: string;
  readonly projectPolicyExecutor?: string;
  /** When set, steps 5–6 are impossible. */
  readonly interactiveSession?: { readonly client: string; readonly host?: string };
  readonly headlessDefault?: string;
  /** Only consulted when not interactive and no earlier pin exists. */
  readonly headlessResourceSelection?: () => string | null;
}

/**
 * Resolve which executor runs. Interactive sessions never fall through to
 * resource selection — unknown host still stays interactive.
 */
export function resolveExecutor(input: PrecedenceInput): ExecutorResolution {
  if (input.requestOverride?.trim()) {
    return {
      executor: input.requestOverride.trim(),
      source: 'request-override',
      interactive: input.interactiveSession !== undefined,
    };
  }
  if (input.runPin?.trim()) {
    return {
      executor: input.runPin.trim(),
      source: 'run-pin',
      interactive: input.interactiveSession !== undefined,
    };
  }
  if (input.projectPolicyExecutor?.trim()) {
    return {
      executor: input.projectPolicyExecutor.trim(),
      source: 'project-policy',
      interactive: input.interactiveSession !== undefined,
    };
  }
  if (input.interactiveSession) {
    return {
      executor: input.interactiveSession.client,
      source: 'active-interactive-session',
      interactive: true,
    };
  }
  if (input.headlessDefault?.trim()) {
    return {
      executor: input.headlessDefault.trim(),
      source: 'headless-default',
      interactive: false,
    };
  }
  if (input.headlessResourceSelection) {
    const picked = input.headlessResourceSelection();
    if (picked?.trim()) {
      return {
        executor: picked.trim(),
        source: 'headless-resource-selection',
        interactive: false,
      };
    }
  }
  throw new Error('no executor: no interactive session and no headless pin or selection');
}
