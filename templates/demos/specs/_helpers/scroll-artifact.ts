/**
 * templates/demos/specs/_helpers/scroll-artifact.ts — shared Act 2 scroll helpers.
 *
 * Used by Construct cockpit demos and copied into project .cx/demos/specs/ on init.
 */

import { type Page, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

type RevealArtifactOpts = {
  file?: string;
  basePath?: string;
  artifactDir?: string;
  mode?: string;
  baseUrl?: string;
};

export async function scrollPdfViewer(page: Page) {
  await page.waitForTimeout(1500);
  const viewer = page.locator('embed[type="application/pdf"], #viewer, pdf-viewer');
  if (await viewer.count()) {
    await viewer.first().click({ timeout: 5000 }).catch(() => page.mouse.click(640, 360));
  } else {
    await page.mouse.click(640, 360);
  }
  await page.waitForTimeout(800);

  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(900);
  }
  await page.waitForTimeout(1500);
}

export async function scrollPage(page: Page, { steps = 10, delta = 500, pauseMs = 700 } = {}) {
  await page.waitForTimeout(1000);
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(pauseMs);
  }
  await page.waitForTimeout(1000);
}

export async function revealArtifact(page: Page, {
  file,
  basePath = '/demo-preview',
  artifactDir = process.env.CONSTRUCT_DEMO_ARTIFACT_DIR || '',
  mode = process.env.DEMO_ARTIFACT_REVEAL_MODE || 'constructPreview',
  baseUrl = process.env.BASE_URL || '',
}: RevealArtifactOpts = {}) {
  const artifactFile = file || process.env.DEMO_ARTIFACT_FILE || '';
  const dir = artifactDir;
  const artifactPath = dir && artifactFile ? path.join(dir, artifactFile) : '';
  if (!artifactFile || !dir || !fs.existsSync(artifactPath)) {
    return;
  }

  const encoded = encodeURIComponent(artifactFile);
  const url = mode === 'sameOrigin' && baseUrl
    ? `${baseUrl.replace(/\/$/, '')}/${encoded}`
    : `${basePath}/${encoded}`;

  await page.goto(url);
  await page.waitForLoadState('domcontentloaded');

  let usedPdf = true;
  try {
    await expect(page).toHaveURL(new RegExp(artifactFile.replace('.', '\\.')));
    await scrollPdfViewer(page);
  } catch {
    usedPdf = false;
    const htmlName = artifactFile.replace(/\.pdf$/i, '.html');
    const htmlPath = path.join(dir, htmlName);
    if (!fs.existsSync(htmlPath)) {
      throw new Error(`PDF viewer scroll failed and HTML fallback missing: ${htmlPath}`);
    }
    const htmlUrl = mode === 'sameOrigin' && baseUrl
      ? `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(htmlName)}`
      : `${basePath}/${encodeURIComponent(htmlName)}`;
    await page.goto(htmlUrl);
    await page.waitForLoadState('domcontentloaded');
    await scrollPage(page);
  }

  if (!usedPdf && process.env.CI) {
    throw new Error('PDF viewer automation failed on CI; HTML fallback used — fix PDF scroll selectors');
  }
}
