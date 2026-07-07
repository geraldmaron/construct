/**
 * lib/init-update-guide.mjs — detect and migrate stale .cx/construct_guide.md copies.
 *
 * Older inits wrote R&D-specific language, fixed port URLs, or root-level guides.
 * init:update proposes or applies the current templates/docs/construct_guide.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { constructDir } from './paths.mjs';
import { projectConfigDir, configPath } from './config-dir.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const STALE_GUIDE_MARKERS = [
  /R&D\s+(intake|classification)/i,
  /review-queue/i,
  /localhost:54330\b/,
  /54329-54339/,
  /construct init.*per.?machine/i,
  /construct init.*machine setup/i,
  /Welcome to Construct[\s\S]{0,400}repo root/i,
];

export function locateConstructGuide(targetDir) {
  const cxGuide = configPath(targetDir, 'construct_guide.md');
  if (fs.existsSync(cxGuide)) return { path: cxGuide, location: '.cx' };
  const rootGuide = path.join(targetDir, 'construct_guide.md');
  if (fs.existsSync(rootGuide)) return { path: rootGuide, location: 'root' };
  return null;
}

export function shippedConstructGuidePath() {
  const fromInstall = path.join(constructDir(), 'templates', 'docs', 'construct_guide.md');
  if (fs.existsSync(fromInstall)) return fromInstall;
  return path.join(REPO_ROOT, 'templates', 'docs', 'construct_guide.md');
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function isStaleConstructGuide(content) {
  if (!content || !content.trim()) return false;
  if (!content.includes('construct intake --help')) return true;
  return STALE_GUIDE_MARKERS.some((re) => re.test(content));
}

export function needsConstructGuideUpdate(targetDir) {
  const located = locateConstructGuide(targetDir);
  if (!located) return { needed: false };
  const content = fs.readFileSync(located.path, 'utf8');
  const shippedPath = shippedConstructGuidePath();
  if (!fs.existsSync(shippedPath)) return { needed: false };
  const shipped = fs.readFileSync(shippedPath, 'utf8');
  if (sha256(content) === sha256(shipped)) return { needed: false };
  if (!isStaleConstructGuide(content)) return { needed: false };
  return { needed: true, located, content, shipped };
}

export function writeConstructGuideProposal(targetDir, { located, shipped }) {
  const proposalDir = configPath(targetDir, 'proposals');
  fs.mkdirSync(proposalDir, { recursive: true });
  const proposalPath = path.join(proposalDir, 'construct_guide.construct-update.md');
  const body = [
    '# Proposed construct_guide.md update',
    '',
    'Your orientation guide predates current Construct branding and intake terminology.',
    'Merge the sections you still need from your copy, then replace `.cx/construct_guide.md`',
    'with the shipped template below (or run `construct init:update --apply-guide`).',
    '',
    located.location === 'root'
      ? '**Note:** the guide still lives at repo root; relocate to `.cx/construct_guide.md` (gitignored).'
      : '',
    '',
    '## Shipped template (current standard)',
    '',
    shipped.trimEnd(),
    '',
  ].filter(Boolean).join('\n');
  fs.writeFileSync(proposalPath, body, 'utf8');
  return proposalPath;
}

export function applyConstructGuideUpdate(targetDir, shippedContent) {
  const cxDir = projectConfigDir(targetDir);
  fs.mkdirSync(cxDir, { recursive: true });
  const dest = path.join(cxDir, 'construct_guide.md');
  const rootLegacy = path.join(targetDir, 'construct_guide.md');

  if (fs.existsSync(dest)) {
    fs.copyFileSync(dest, `${dest}.bak`);
  }
  fs.writeFileSync(dest, shippedContent, 'utf8');

  if (fs.existsSync(rootLegacy)) {
    fs.rmSync(rootLegacy);
  }

  return dest;
}
