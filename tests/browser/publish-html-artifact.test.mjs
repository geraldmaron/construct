/**
 * tests/browser/publish-html-artifact.test.mjs — LMCP-L8 Playwright adoption:
 * real headless-Chromium rendering check for the `construct publish` HTML
 * export path (lib/document-export.mjs exportMarkdown({ format: 'html' }), the
 * same branded-template pipeline `construct publish --format html` drives).
 *
 * CI-optional-gated: chromium.launch() is wrapped in a try/catch and the whole
 * suite self-skips (does not fail) when no Playwright browser is installed, so
 * a contributor machine or CI runner without `npx playwright install` stays
 * green on the default `npm test` sweep (scripts/run-tests.mjs has no special
 * case for tests/browser/). .github/workflows/ci.yml runs the real assertions
 * in a dedicated, non-blocking job that does install the browser.
 *
 * Checks the three properties named in the LMCP-L8 spec: fonts render (the
 * construct-web.html template embeds fonts as base64 data: URIs via pandoc
 * --embed-resources, a zero-network render), no console errors, and links
 * resolve (rendered <a href> matches the source markdown link target — a
 * static-render check against the DOM, not a live network fetch, so CI never
 * depends on an external site being reachable).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportMarkdown } from '../../lib/document-export.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

async function launchChromium() {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    return browser;
  } catch (err) {
    return { unavailable: true, reason: err.message };
  }
}

function buildFixtureArtifact() {
  const dir = mkdtempSync(join(tmpdir(), 'cx-browser-publish-'));
  const mdPath = join(dir, 'sample.md');
  const htmlPath = join(dir, 'sample.html');
  writeFileSync(
    mdPath,
    [
      '# LMCP-L8 fixture artifact',
      '',
      'Rendering check for the branded HTML export template.',
      '',
      '[example link](https://example.com/lmcp-l8)',
      '',
    ].join('\n'),
  );
  const result = exportMarkdown({ inputPath: mdPath, outputPath: htmlPath, format: 'html', repoRoot: ROOT });
  return { dir, htmlPath, result };
}

test('[LMCP-L8] published HTML artifact renders cleanly in headless Chromium', async (t) => {
  const browser = await launchChromium();
  if (browser.unavailable) {
    t.skip(`no Playwright Chromium install available: ${browser.reason}`);
    return;
  }

  const { dir, htmlPath, result } = buildFixtureArtifact();
  try {
    assert.ok(result.ok, `exportMarkdown html export failed: ${result.message}`);

    const page = await browser.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('requestfailed', (req) => failedRequests.push(`${req.url()}: ${req.failure()?.errorText}`));

    await page.goto(`file://${htmlPath}`, { waitUntil: 'load' });

    assert.deepEqual(consoleErrors, [], `console errors while rendering the artifact: ${consoleErrors.join('; ')}`);
    assert.deepEqual(pageErrors, [], `uncaught page errors while rendering the artifact: ${pageErrors.join('; ')}`);
    assert.deepEqual(failedRequests, [], `failed resource loads while rendering the artifact: ${failedRequests.join('; ')}`);

    const title = await page.title();
    assert.equal(title, 'LMCP-L8 fixture artifact');

    const bodyText = await page.textContent('body');
    assert.ok(bodyText.includes('Rendering check for the branded HTML export template.'), 'artifact body text missing from rendered DOM');

    const linkHref = await page.getAttribute('a[href="https://example.com/lmcp-l8"]', 'href');
    assert.equal(linkHref, 'https://example.com/lmcp-l8', 'source markdown link did not resolve to the expected href in rendered HTML');

    /* eslint-disable no-undef -- browser-context callback: document/CSSFontFaceRule run inside Chromium, not Node. */
    const fontFaceCount = await page.evaluate(() => {
      let count = 0;
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) if (rule instanceof CSSFontFaceRule) count += 1;
        } catch { /* cross-origin sheets are not readable; none expected here */ }
      }
      return count;
    });
    /* eslint-enable no-undef */
    assert.ok(fontFaceCount > 0, 'expected at least one embedded @font-face rule in the branded HTML template');

    await page.close();
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
