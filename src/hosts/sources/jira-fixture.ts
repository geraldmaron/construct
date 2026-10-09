/**
 * hosts/sources/jira-fixture.ts — a stand-in Jira reader for testing and
 * evaluation, backed by JSON exports on disk instead of a live tracker.
 *
 * Active only when CONSTRUCT_JIRA_FIXTURES names a directory. A source of
 * kind jira with locator PROJ reads <dir>/PROJ.json, which holds either a
 * list of issues or an object with an "issues" list; each issue needs a
 * "key". Every issue becomes an item whose reference is its key, so a step
 * can cite PLAT-101 and have it resolve. Its text is kept the way the hook
 * keeps a connector's: readable, credentials removed, capped, and marked
 * when cut. Reports are marked "reported", not "witnessed": a fixture says
 * what a tracker would have said, it is not one.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReadOutcome, SnapshotItem, SourceReader } from '../../kernel/source/connector.ts';
import { redact } from '../../kernel/render/redact.ts';
import { issueUrl, readableText } from '../hooks/handlers.ts';

export const JIRA_FIXTURES_ENV = 'CONSTRUCT_JIRA_FIXTURES';
/** Text kept per issue so numbers and wording can be checked against it. */
export const FIXTURE_TEXT_CAP = 16 * 1024;

function issuesOf(raw: unknown): Record<string, unknown>[] {
  const list = Array.isArray(raw) ? raw : (raw as { issues?: unknown } | null)?.issues;
  if (!Array.isArray(list)) throw new Error('fixture must be a list of issues or an object with an "issues" list');
  return list.filter((i): i is Record<string, unknown> => i !== null && typeof i === 'object' && typeof (i as { key?: unknown }).key === 'string');
}

function titleOf(issue: Record<string, unknown>): string {
  for (const k of ['summary', 'title', 'name']) if (typeof issue[k] === 'string') return issue[k];
  return String(issue.key);
}

export function createJiraFixtureReader(dir: string): SourceReader {
  return async ({ locator }): Promise<ReadOutcome> => {
    if (!locator) return { outcome: 'unreachable', reason: 'the source names no project key' };
    const path = join(dir, `${locator}.json`);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      return { outcome: 'unreachable', reason: `no readable fixture for ${locator} in ${JIRA_FIXTURES_ENV}: ${(error as Error).message}` };
    }
    let issues: Record<string, unknown>[];
    try {
      issues = issuesOf(raw);
    } catch (error) {
      return { outcome: 'unreachable', reason: `${locator}.json: ${(error as Error).message}` };
    }
    const items: SnapshotItem[] = issues
      .map((issue) => {
        const key = String(issue.key);
        const text = redact(readableText(issue));
        const url = issueUrl(issue, key);
        return {
          externalRef: key,
          kind: 'work_item',
          name: redact(titleOf(issue)),
          // The version is the whole issue as exported; what is kept is what a person would read in it.
          attributes: { fingerprint: createHash('sha256').update(JSON.stringify(issue)).digest('hex'), text: text.slice(0, FIXTURE_TEXT_CAP), ...(text.length > FIXTURE_TEXT_CAP ? { truncated: true } : {}), ...(url ? { url } : {}) },
        };
      })
      .sort((a, b) => a.externalRef.localeCompare(b.externalRef));
    const digest = `sha256:${createHash('sha256').update(items.map((i) => `${i.externalRef}\t${String(i.attributes?.fingerprint)}`).join('\n')).digest('hex')}`;
    return { outcome: 'read', report: { digest, summary: `${String(items.length)} issue(s) in fixture ${locator}`, evidenceRef: `jira:${locator}`, evidence: 'reported', items } };
  };
}
