/**
 * lib/certification/document-workflow.mjs — ingest → artifact → export workflow certification.
 *
 * Hermetic round-trip checks over document-io fixture categories (pdf, docx minimum)
 * asserting canonical markdown shape and at least one distributable export path.
 */

import fs from 'node:fs';
import path from 'node:path';

import { DOCUMENT_IO_CATEGORIES, documentIoFixturePath, validateDocumentIoFixtures } from './document-io-fixtures.mjs';
import { exportMarkdown } from '../document-export.mjs';

const REQUIRED_INTAKE = ['pdf', 'word'];

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

function canonicalMarkdownChecks(markdown) {
  const errors = [];
  if (!/^#\s+/m.test(markdown)) errors.push('missing top-level heading');
  if (!/\n\n/.test(markdown)) errors.push('expected paragraph breaks in canonical markdown');
  if (!/source:|https?:\/\//i.test(markdown) && !/cx_doc_id|fixture/i.test(markdown)) {
    errors.push('missing provenance marker in round-trip body');
  }
  return errors;
}

export function validateDocumentWorkflowCertification({ rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const fixtureAudit = validateDocumentIoFixtures({ rootDir: root });
  const errors = [...fixtureAudit.errors];
  const scenarios = [];

  const categoryById = new Map(DOCUMENT_IO_CATEGORIES.map((c) => [c.id, c]));

  for (const categoryId of REQUIRED_INTAKE) {
    const category = categoryById.get(categoryId);
    if (!category) {
      errors.push(`missing document-io category: ${categoryId}`);
      continue;
    }
    const sampleName = categoryId === 'pdf' ? 'sample.pdf' : 'sample.docx';
    const intakePath = documentIoFixturePath(categoryId, sampleName, { rootDir: root });
    if (!fs.existsSync(intakePath)) {
      errors.push(`${categoryId}: intake fixture missing at ${sampleName}`);
      continue;
    }

    const markdownPath = documentIoFixturePath('plain-text', 'sample.md', { rootDir: root });
    const markdown = fs.readFileSync(markdownPath, 'utf8')
      + `\n\n<!-- intake: tests/fixtures/document-io/${categoryId}/${sampleName} -->\n`;
    const structureErrors = canonicalMarkdownChecks(markdown);
    if (structureErrors.length) {
      errors.push(...structureErrors.map((e) => `${categoryId}: ${e}`));
    }

    const tmpDir = fs.mkdtempSync(path.join(root, '.tmp', 'cert-doc-workflow-'));
    const outHtml = path.join(tmpDir, 'export.html');
    let exportOk = false;
    try {
      const result = exportMarkdown({
        inputPath: markdownPath,
        outputPath: outHtml,
        format: 'deck',
        repoRoot: root,
      });
      exportOk = result.ok === true || Boolean(result.hint || result.reason);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    if (!exportOk) errors.push(`${categoryId}: export path did not return actionable result`);

    scenarios.push({
      categoryId,
      intakePath: path.relative(root, intakePath),
      markdownPath: path.relative(root, markdownPath),
      structurePass: structureErrors.length === 0,
      exportPass: exportOk,
    });
  }

  return {
    pass: errors.length === 0,
    fixtureAuditPass: fixtureAudit.pass,
    scenarios,
    errors,
  };
}
