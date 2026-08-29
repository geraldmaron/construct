/**
 * tests/harness/recorded-namer.ts — recorded host-namer consultations.
 *
 * Door 3 fixtures for the two first-run sentences. Each reply is what a
 * model that read the catalog and those words named. The product path is
 * still createHostNamer + mapImplicationsNamed. This file is not shipped
 * and is not a keyword list.
 */

import { createHostNamer } from '../../src/hosts/namer.ts';
import type { DomainNamer } from '../../src/kernel/implication/naming.ts';
import type { HostAdapter, HostResult } from '../../src/kernel/hosts/interface.ts';

export const POLAND = 'We want to hire a contractor in Poland';
export const WARSAW =
  'We need to bring on a freelancer in Warsaw who will get our customer list and a production login.';

const RECORDED: ReadonlyArray<{
  readonly words: string;
  readonly domains: ReadonlyArray<{ readonly domain: string; readonly why: string }>;
}> = [
  {
    words: WARSAW,
    domains: [
      { domain: 'contracts', why: 'bringing on a freelancer is an agreement with an outside party' },
      { domain: 'privacy', why: 'the freelancer will get the customer list' },
      { domain: 'security', why: 'a production login is who can reach production' },
      { domain: 'employment', why: 'bringing on a freelancer is engaging a person' },
    ],
  },
  {
    words: POLAND,
    domains: [
      { domain: 'contracts', why: 'hiring a contractor is an agreement with an outside party' },
      { domain: 'privacy', why: 'the hire happens in Poland, a place the person will work from' },
      { domain: 'employment', why: 'hiring a contractor is engaging a person' },
    ],
  },
];

export function recordedHostNamer(): DomainNamer {
  const host: HostAdapter = {
    name: 'fixture',
    kind: 'general',
    capabilities: [],
    init: async (): Promise<void> => {},
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    invoke: async (request: unknown): Promise<HostResult> => {
      const task =
        typeof (request as { task?: unknown }).task === 'string'
          ? (request as { task: string }).task
          : '';
      if (!task.includes('contracts:') || !task.includes('privacy:')) {
        return {
          id: 'x',
          status: 'error',
          output: null,
          error: 'namer prompt must carry the catalog',
        };
      }
      const hit = RECORDED.find((row) => task.includes(row.words));
      return {
        id: 'x',
        status: 'ok',
        output: { text: JSON.stringify({ domains: hit?.domains ?? [] }) },
        error: null,
      };
    },
  };
  return createHostNamer(host);
}
