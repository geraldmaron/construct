/**
 * lib/demo-annotations.mjs — chapter markers and accessibility descriptions for recorded demos (construct-tsyfe.5.6).
 *
 * Derives sidecar metadata from demo script steps (title/prompt/command plus optional
 * annotation/chapterTitle fields) so script-only and recorded surfaces stay aligned.
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadDemoScript } from './demo-script.mjs';

export const DEMO_ANNOTATION_SIDECAR_SCHEMA = 'construct/demo-annotation-sidecar/1';

const NO_DESCRIPTION = 'no description available';

export function normalizeDemoStep(step, index) {
  const title = step?.chapterTitle || step?.title || null;
  return {
    index: index + 1,
    title,
    annotation: step?.annotation || step?.prompt || null,
    chapterTitle: step?.chapterTitle || step?.title || null,
    command: step?.command || null,
  };
}

export function buildDemoChapterSidecar(script, {
  demoName,
  engine = 'unknown',
  artifactPath = null,
} = {}) {
  const steps = Array.isArray(script?.steps) ? script.steps : [];
  const chapters = steps.map((step, index) => normalizeDemoStep(step, index));
  return {
    schema: DEMO_ANNOTATION_SIDECAR_SCHEMA,
    demo: demoName || script?.name || null,
    engine,
    artifactPath,
    chapterCount: chapters.length,
    chapters,
    accessibilityDescription: assembleAccessibilityDescription(script),
    generatedAt: new Date().toISOString(),
  };
}

export function assembleAccessibilityDescription(script) {
  const steps = Array.isArray(script?.steps) ? script.steps : [];
  const titled = steps
    .map((step, index) => normalizeDemoStep(step, index))
    .filter((step) => step.title || step.annotation);

  if (titled.length === 0) return NO_DESCRIPTION;

  return titled
    .map((step) => {
      const label = step.chapterTitle || step.title || `Step ${step.index}`;
      const detail = step.annotation || step.command || '';
      return detail ? `${label}: ${detail}` : label;
    })
    .join('; ');
}

export function sidecarPathForArtifact(artifactPath) {
  if (!artifactPath) return null;
  const parsed = path.parse(artifactPath);
  return path.join(parsed.dir, `${parsed.name}.chapters.json`);
}

export function writeDemoAnnotationSidecar(artifactPath, sidecar, { writeFileSyncFn = fs.writeFileSync, mkdirSyncFn = fs.mkdirSync } = {}) {
  const out = sidecarPathForArtifact(artifactPath);
  if (!out) return { ok: false, message: 'artifactPath required' };
  mkdirSyncFn(path.dirname(out), { recursive: true });
  writeFileSyncFn(out, `${JSON.stringify(sidecar, null, 2)}\n`, 'utf8');
  return { ok: true, sidecarPath: out, sidecar };
}

export function attachRecordingAnnotations({
  demoName,
  artifactPath,
  engine,
  script = null,
  opts = {},
} = {}) {
  const resolvedScript = script || loadDemoScript(demoName, opts);
  if (!resolvedScript || !artifactPath) {
    return { ok: false, message: 'script and artifactPath required for annotation sidecar' };
  }
  const sidecar = buildDemoChapterSidecar(resolvedScript, {
    demoName,
    engine,
    artifactPath,
  });
  if (sidecar.chapterCount === 0) {
    return { ok: true, sidecar, sidecarPath: null, skipped: true };
  }
  const written = writeDemoAnnotationSidecar(artifactPath, sidecar);
  return { ok: written.ok, sidecar, sidecarPath: written.sidecarPath ?? null };
}
