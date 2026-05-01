/**
 * lib/docs-routing.mjs — suggests documentation lanes for files based on content and naming.
 *
 * Maps file paths and content patterns to documentation sections (prds, adrs, rfcs, etc.)
 * for automatic documentation organization.
 */

import path from 'node:path';

export const DOC_LANE_DIRS = {
  adrs: 'adr',
  briefs: 'briefs',
  changelogs: 'changelogs',
  intake: 'intake',
  memos: 'memos',
  meetings: 'meetings',
  notes: 'notes',
  onboarding: 'onboarding',
  postmortems: 'postmortems',
  prds: 'prds',
  rfcs: 'rfcs',
  runbooks: 'runbooks',
};

export function docLaneDir(laneKey) {
  return DOC_LANE_DIRS[laneKey] ?? laneKey;
}

export function suggestDocsLaneForFile(filePath, content = '') {
  const fileName = path.basename(filePath).toLowerCase();

  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];
    const typeMatch = frontmatter.match(/type:\s*(prd|adr|rfc|memo|runbook|brief|meeting|note)/i);
    if (typeMatch) {
      const type = typeMatch[1].toLowerCase();
      if (type === 'adr') return 'adrs';
      if (type === 'prd') return 'prds';
      if (type === 'rfc') return 'rfcs';
      if (type === 'memo') return 'memos';
      if (type === 'runbook') return 'runbooks';
      if (type === 'brief') return 'briefs';
      if (type === 'meeting') return 'meetings';
      if (type === 'note') return 'notes';
    }
  }

  const prdPatterns = ['prd', 'product', 'requirement', 'spec', 'feature'];
  const adrPatterns = ['adr', 'architecture', 'design', 'decision'];
  const rfcPatterns = ['rfc', 'request', 'comment', 'proposal'];
  const memoPatterns = ['memo', 'memorandum'];
  const runbookPatterns = ['runbook', 'run book', 'operational', 'procedure'];
  const briefPatterns = ['brief', 'one-pager', 'signal', 'evidence', 'research'];
  const changelogPatterns = ['changelog', 'release-notes', 'releases'];
  const onboardingPatterns = ['onboarding', 'setup', 'getting-started', 'local-setup'];
  const postmortemPatterns = ['postmortem', 'incident-report', 'incident', 'sev-'];
  const meetingPatterns = ['meeting', 'minutes', 'retro', 'standup', 'agenda', 'sync', '1-1', '1:1'];
  const notePatterns = ['note', 'notes', 'scratchpad', 'journal'];

  const checkPatterns = (patterns) => patterns.some((p) => fileName.includes(p));

  if (checkPatterns(prdPatterns)) return 'prds';
  if (checkPatterns(adrPatterns)) return 'adrs';
  if (checkPatterns(rfcPatterns)) return 'rfcs';
  if (checkPatterns(memoPatterns)) return 'memos';
  if (checkPatterns(runbookPatterns)) return 'runbooks';
  if (checkPatterns(briefPatterns)) return 'briefs';
  if (checkPatterns(changelogPatterns)) return 'changelogs';
  if (checkPatterns(onboardingPatterns)) return 'onboarding';
  if (checkPatterns(postmortemPatterns)) return 'postmortems';
  if (checkPatterns(meetingPatterns)) return 'meetings';
  if (checkPatterns(notePatterns)) return 'notes';

  const preview = content.slice(0, 4000).toLowerCase();
  if (preview.includes('product requirement') || preview.includes('user story') || preview.includes('acceptance criteria')) return 'prds';
  if (preview.includes('architecture decision') || preview.includes('design decision') || preview.includes('we decided')) return 'adrs';
  if (preview.includes('request for comments') || preview.includes('please comment') || preview.includes('drawbacks')) return 'rfcs';
  if (preview.includes('decision memo') || preview.includes('memorandum')) return 'memos';
  if (preview.includes('runbook') || preview.includes('operational procedure') || preview.includes('troubleshooting')) return 'runbooks';
  if (preview.includes('signal') || preview.includes('evidence') || preview.includes('competitive analysis') || preview.includes('research brief')) return 'briefs';
  if (preview.includes('## added') || preview.includes('## changed') || preview.includes('## fixed') || preview.includes('release notes')) return 'changelogs';
  if (preview.includes('local setup') || preview.includes('getting started') || preview.includes('prerequisites')) return 'onboarding';
  if (preview.includes('postmortem') || preview.includes('incident report') || (preview.includes('root cause') && preview.includes('timeline') && preview.includes('impact'))) return 'postmortems';
  if (preview.includes('meeting notes') || preview.includes('meeting minutes') || preview.includes('attendees') && preview.includes('action items')) return 'meetings';
  if (preview.includes('notes') || preview.includes('working notes')) return 'notes';

  return null;
}
