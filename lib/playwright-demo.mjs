/**
 * lib/playwright-demo.mjs — workspace-agnostic Playwright demo recording.
 *
 * Spawns `npx playwright test --config <config> <spec>` with env passthrough for
 * artifact reveal, collects video output, and transcodes webm→mp4 when ffmpeg exists.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { sanitizeNpmSpawnEnv } from './npm-spawn-env.mjs';

export function resolvePlaywrightPackage(workspace, repoRoot) {
  const candidates = [
    path.join(workspace, 'node_modules', '@playwright', 'test'),
    path.join(repoRoot, 'node_modules', '@playwright', 'test'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

export function resolvePlaywrightConfig(workspace) {
  const candidates = ['playwright.config.mjs', 'playwright.config.ts'].map((f) => path.join(workspace, f));
  return candidates.find((p) => fs.existsSync(p)) || null;
}

export function detectPlaywrightDemo({ workspace, cwd = process.cwd(), repoRoot = cwd } = {}) {
  const root = repoRoot || cwd;
  const resolvedWorkspace = path.resolve(root, workspace || '.');
  const missing = [];
  if (!fs.existsSync(path.join(resolvedWorkspace, 'package.json'))) {
    missing.push(`package.json in ${workspace || '.'}`);
  }
  const config = resolvePlaywrightConfig(resolvedWorkspace);
  if (!config) missing.push(`playwright.config.mjs in ${workspace || '.'}`);
  if (!resolvePlaywrightPackage(resolvedWorkspace, root)) {
    missing.push('@playwright/test (npm install in workspace)');
  }
  return {
    ok: true,
    present: missing.length === 0,
    workspace: resolvedWorkspace,
    config,
    missing,
    message: missing.length === 0
      ? 'Playwright demo tooling ready'
      : `Install Playwright demo deps: ${missing.join('; ')}`,
  };
}

export function locateFfmpeg() {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.trim().split('\n')[0] || null;
}

export function collectVideoFiles(dirs) {
  const collected = [];
  function walk(dir) {
    if (!dir || !fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(webm|mp4)$/.test(ent.name)) collected.push(p);
    }
  }
  for (const dir of dirs) walk(dir);
  return collected;
}

export function newestVideo(paths) {
  if (!paths.length) return null;
  return paths
    .map((p) => ({ p, mtime: fs.statSync(p).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0].p;
}

export function transcodeWebmToMp4(src, dest) {
  const ffmpeg = locateFfmpeg();
  if (!ffmpeg) return { ok: false, message: 'ffmpeg not on PATH' };
  const result = spawnSync(ffmpeg, [
    '-y', '-i', src,
    '-c:v', 'libx264',
    '-crf', '18',
    '-preset', 'medium',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    dest,
  ], { encoding: 'utf8', timeout: 180_000 });
  if (result.status !== 0) {
    return {
      ok: false,
      message: `ffmpeg failed (exit ${result.status}): ${(result.stderr || '').trim().slice(0, 300)}`,
    };
  }
  return { ok: true, outputPath: dest };
}

export function finalizeDemoVideo({ sourcePath, outputPath, format = 'mp4' }) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return { ok: false, message: 'No video artifact produced' };
  }
  const target = outputPath || sourcePath;
  fs.mkdirSync(path.dirname(target), { recursive: true });

  if (format === 'mp4' && sourcePath.endsWith('.webm')) {
    const transcode = transcodeWebmToMp4(sourcePath, target);
    if (!transcode.ok) return transcode;
    return { ok: true, outputPath: target, format: 'mp4', engine: 'playwright+ffmpeg' };
  }

  if (path.resolve(sourcePath) !== path.resolve(target)) {
    fs.copyFileSync(sourcePath, target);
  }
  return {
    ok: true,
    outputPath: target,
    format: path.extname(target).slice(1) || format,
    engine: 'playwright',
  };
}

export function buildArtifactRevealEnv(recording, {
  repoRoot,
  cwd = repoRoot,
  artifactDir = null,
  artifactFile = null,
  env = process.env,
} = {}) {
  const reveal = recording?.artifactReveal;
  const out = { ...env };
  if (!reveal && !artifactDir && !artifactFile) return out;

  const file = artifactFile || reveal?.file || reveal?.path || '';
  const staticDir = artifactDir
    || (reveal?.staticDir ? path.resolve(repoRoot || cwd, reveal.staticDir) : '');

  if (staticDir) out.CONSTRUCT_DEMO_ARTIFACT_DIR = staticDir;
  if (file) out.DEMO_ARTIFACT_FILE = file;
  if (reveal?.mode) out.DEMO_ARTIFACT_REVEAL_MODE = reveal.mode;
  if (recording?.baseUrl) out.BASE_URL = recording.baseUrl;
  if (recording?.webServer && !recording.skipWebServer) {
    out.DEMO_WEB_SERVER_COMMAND = recording.webServer.command;
    out.DEMO_WEB_SERVER_URL = recording.webServer.url;
    out.DEMO_WEB_SERVER_CWD = path.resolve(repoRoot || cwd, recording.webServer.cwd || recording.workspace || '.');
    out.DEMO_WEB_SERVER_TIMEOUT = String(recording.webServer.timeout || 120_000);
  }
  if (recording?.skipWebServer) out.SKIP_WEBSERVER = '1';
  return out;
}

export function resolveRecordingPaths(recording, { repoRoot, cwd = repoRoot } = {}) {
  const root = repoRoot || cwd;
  const workspace = path.resolve(root, recording.workspace || '.');
  const spec = path.isAbsolute(recording.spec)
    ? recording.spec
    : path.resolve(root, recording.spec);
  const config = recording.playwrightConfig
    ? (path.isAbsolute(recording.playwrightConfig)
      ? recording.playwrightConfig
      : path.resolve(root, recording.playwrightConfig))
    : resolvePlaywrightConfig(workspace);
  const outputDir = recording.output?.path
    ? path.dirname(path.resolve(root, recording.output.path))
    : path.join(cwd, '.cx', 'demos');
  return { workspace, spec, config, outputDir };
}

export function recordPlaywrightDemo(recording, {
  cwd = process.cwd(),
  repoRoot,
  outputDir = null,
  outputPath = null,
  format = null,
  artifactDir = null,
  artifactFile = null,
  env = process.env,
  timeout = null,
} = {}) {
  const root = repoRoot || cwd;
  const name = recording.name || path.basename(recording.spec || '', '.spec.ts');
  const { workspace, spec, config, outputDir: defaultOutDir } = resolveRecordingPaths(recording, { repoRoot: root, cwd });
  const detection = detectPlaywrightDemo({ workspace, repoRoot: root, cwd });
  if (!detection.present) {
    return { ok: false, name, missing: detection.missing, message: detection.message };
  }
  if (!config || !fs.existsSync(config)) {
    return { ok: false, name, message: `Playwright config not found for workspace ${recording.workspace || '.'}` };
  }
  if (!fs.existsSync(spec)) {
    return { ok: false, name, message: `Demo spec not found: ${spec}` };
  }

  const outDir = outputDir || defaultOutDir;
  fs.mkdirSync(outDir, { recursive: true });

  const outFormat = format || recording.output?.format || 'mp4';
  const destPath = outputPath
    || (recording.output?.path ? path.resolve(root, recording.output.path) : path.join(outDir, `${name}.${outFormat}`));

  const spawnEnv = buildArtifactRevealEnv(recording, {
    repoRoot: root,
    cwd,
    artifactDir,
    artifactFile,
    env: {
      ...env,
      DEMO_OUTPUT_DIR: outDir,
      CONSTRUCT_DEMO: name,
      CI: env.CI || '',
    },
  });

  const args = ['playwright', 'test', '--config', config, spec];
  if (recording.project) args.push(`--project=${recording.project}`);

  const spawnTimeout = timeout || recording.timeout || 600_000;
  const result = spawnSync('npx', args, {
    cwd: workspace,
    encoding: 'utf8',
    env: sanitizeNpmSpawnEnv(spawnEnv),
    timeout: spawnTimeout,
  });

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || '').trim().slice(0, 500);
    const exitLabel = result.signal ? `signal ${result.signal}` : `exit ${result.status}`;
    return {
      ok: false,
      name,
      message: `Playwright demo failed (${exitLabel})${detail ? `: ${detail}` : ''}`,
    };
  }

  const videos = collectVideoFiles([
    path.join(workspace, 'test-results'),
    outDir,
  ]);
  const newest = newestVideo(videos);
  const finalized = finalizeDemoVideo({ sourcePath: newest, outputPath: destPath, format: outFormat });
  if (!finalized.ok) {
    return { ok: false, name, message: finalized.message };
  }

  return {
    ok: true,
    name,
    outputDir: outDir,
    outputPath: finalized.outputPath,
    format: finalized.format,
    engine: finalized.engine,
    videos: videos.map((p) => path.basename(p)),
    message: `Recorded Playwright demo to ${finalized.outputPath}`,
  };
}
