/**
 * hosts/sources/readers.ts — the source readers this process can offer,
 * assembled in one place so the command line and the MCP server agree.
 */

import { readDirectorySource } from './directory.ts';
import { JIRA_FIXTURES_ENV, createJiraFixtureReader } from './jira-fixture.ts';
import type { SourceReader } from '../../kernel/source/connector.ts';

export function hostReaders(env: Readonly<Record<string, string | undefined>> = process.env): Map<string, SourceReader> {
  const readers = new Map<string, SourceReader>([['directory', readDirectorySource]]);
  const fixtures = env[JIRA_FIXTURES_ENV];
  if (fixtures && fixtures.trim() !== '') readers.set('jira', createJiraFixtureReader(fixtures));
  return readers;
}
