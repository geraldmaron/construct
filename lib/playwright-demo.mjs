/**
 * lib/playwright-demo.mjs — workspace-agnostic Playwright demo recording.
 *
 * Runs tests through the locally resolved @playwright/test CLI via node, collects
 * video paths from a result reporter manifest, and transcodes webm to mp4 when ffmpeg
 * exists. Supports standard video attachments and page.screencast capture modes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { configPath } from './config-dir.mjs';
import { spawnSync } from 'node:child_process';
import { sanitizeNpmSpawnEnv } from './npm-spawn-env.mjs';
import { attachDemoOutcome } from './demo-state.mjs';
import { attachRecordingAnnotations } from './demo-annotations.mjs';
import { PLAYWRIGHT_DEMO_ARTIFACT_REPORTER_CJS } from './playwright-demo-artifact-reporter.mjs';

const ARTIFACT_REPORTER = PLAYWRIGHT_DEMO_ARTIFACT_REPORTER_CJS;

export function resolvePlaywrightPackage(workspace, repoRoot) {
  const candidates = [
    path.join(workspace, 'node_modules', '@playwright', 'test'),
    path.join(repoRoot, 'node_modules', '@playwright', 'test'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

export function resolvePlaywrightCli(workspace, repoRoot) {
  const pkgRoot = resolvePlaywrightPackage(workspace, repoRoot);
  if (!pkgRoot) return null;
  const cli = path.join(pkgRoot, 'cli.js');
  return fs.existsSync(cli) ? cli : null;
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

export function readArtifactManifest(manifestPath) {
  if (!manifestPath || !fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

export function selectPrimaryVideoArtifact(manifest, { recordingMode = 'video' } = {}) {
  if (!manifest?.artifacts?.length) return null;
  const modeMatches = manifest.artifacts.filter((entry) => entry.mode === recordingMode);
  const pool = modeMatches.length ? modeMatches : manifest.artifacts;
  const named = pool.find((entry) => entry.name === 'video' || entry.name === 'screencast');
  if (named?.path) return named.path;
  const videoLike = pool.find((entry) => /\.(webm|mp4)$/i.test(entry.path || ''));
  return videoLike?.path || null;
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
  manifestPath = null,
  recordingMode = 'video',
  screencastOutput = null,
} = {}) {
  const reveal = recording?.artifactReveal;
  const out = { ...env };
  if (!reveal && !artifactDir && !artifactFile && !manifestPath && !screencastOutput) return out;

  const file = artifactFile || reveal?.file || reveal?.path || '';
  const staticDir = artifactDir
    || (reveal?.staticDir ? path.resolve(repoRoot || cwd, reveal.staticDir) : '');

  if (staticDir) out.CONSTRUCT_DEMO_ARTIFACT_DIR = staticDir;
  if (file) out.DEMO_ARTIFACT_FILE = file;
  if (reveal?.mode) out.DEMO_ARTIFACT_REVEAL_MODE = reveal.mode;
  if (recording?.baseUrl) out.BASE_URL = recording.baseUrl;
  if (manifestPath) out.CONSTRUCT_DEMO_ARTIFACT_MANIFEST = manifestPath;
  if (recordingMode) out.CONSTRUCT_DEMO_RECORDING_MODE = recordingMode;
  if (screencastOutput) out.CONSTRUCT_DEMO_SCREENCAST_OUTPUT = screencastOutput;
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
    : configPath(cwd, 'demos');
  return { workspace, spec, config, outputDir };
}


export function writePlaywrightRunnerConfig(baseConfig, {
  manifestPath,
  recordingMode = 'video',
  runnerConfigPath,
} = {}) {
  const basePath = path.resolve(baseConfig);
  const runnerPath = path.resolve(runnerConfigPath);
  const relativeBase = path.relative(path.dirname(runnerPath), basePath).replace(/\\/g, '/');
  const baseImport = relativeBase.startsWith('.') ? relativeBase : `./${relativeBase}`;
  const reporterImport = ARTIFACT_REPORTER.replace(/\\/g, '/');
  const reporterOptions = JSON.stringify({ manifestPath, recordingMode });
  const source = `/**
 * lib/playwright-demo-runner.config.mjs — generated Playwright runner overlay.
 */
import base from '${baseImport}';

const merged = base.default ?? base;
const use = { ...(merged.use || {}) };
if ('${recordingMode}' === 'screencast') use.video = 'off';

export default {
  ...merged,
  use,
  reporter: [
    ['list'],
    ['${reporterImport}', ${reporterOptions}],
  ],
};
`;
  fs.mkdirSync(path.dirname(runnerPath), { recursive: true });
  fs.writeFileSync(runnerPath, source);
  return runnerPath;
}

export function resolveRecordingMode(recording, options = {}) {
  return options.recordingMode || recording.recordingMode || recording.mode || 'video';
}

export function runPlaywrightDemoTests({
  workspace,
  repoRoot,
  config,
  spec,
  env,
  manifestPath,
  project = null,
  recordingMode = 'video',
  timeout = 600_000,
  runnerConfigPath = null,
}) {
  const cli = resolvePlaywrightCli(workspace, repoRoot);
  if (!cli) {
    return {
      ok: false,
      status: null,
      message: 'Locally installed @playwright/test CLI not found',
    };
  }

  const overlayConfig = runnerConfigPath || path.join(workspace, '.construct', 'playwright-runner.config.mjs');
  writePlaywrightRunnerConfig(config, { manifestPath, recordingMode, runnerConfigPath: overlayConfig });

  const args = [
    cli,
    'test',
    '--config', overlayConfig,
    spec,
  ];
  if (project) args.push(`--project=${project}`);

  const result = spawnSync(process.execPath, args, {
    cwd: workspace,
    encoding: 'utf8',
    env: sanitizeNpmSpawnEnv(env),
    timeout,
  });

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || '').trim().slice(0, 500);
    const exitLabel = result.signal ? `signal ${result.signal}` : `exit ${result.status}`;
    return {
      ok: false,
      status: result.status,
      message: `Playwright demo failed (${exitLabel})${detail ? `: ${detail}` : ''}`,
    };
  }

  return { ok: true, status: result.status, manifestPath };
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
  recordingMode = null,
} = {}) {
  const root = repoRoot || cwd;
  const name = recording.name || path.basename(recording.spec || '', '.spec.ts');
  const mode = resolveRecordingMode(recording, { recordingMode });
  const { workspace, spec, config, outputDir: defaultOutDir } = resolveRecordingPaths(recording, { repoRoot: root, cwd });
  const detection = detectPlaywrightDemo({ workspace, repoRoot: root, cwd });
  if (!detection.present) {
    return attachDemoOutcome({
      name,
      missing: detection.missing,
      message: detection.message,
    }, { cwd, name, state: 'unavailable', persist: false });
  }
  if (!config || !fs.existsSync(config)) {
    return attachDemoOutcome({
      name,
      message: `Playwright config not found for workspace ${recording.workspace || '.'}`,
    }, { cwd, name, state: 'unavailable', persist: false });
  }
  if (!fs.existsSync(spec)) {
    return attachDemoOutcome({
      name,
      message: `Demo spec not found: ${spec}`,
    }, { cwd, name, state: 'failed', persist: false });
  }

  const outDir = outputDir || defaultOutDir;
  fs.mkdirSync(outDir, { recursive: true });

  const outFormat = format || recording.output?.format || 'mp4';
  const destPath = outputPath
    || (recording.output?.path ? path.resolve(root, recording.output.path) : path.join(outDir, `${name}.${outFormat}`));
  const manifestPath = path.join(outDir, `${name}.artifact-manifest.json`);
  const screencastOutput = mode === 'screencast'
    ? path.join(outDir, `${name}-screencast.webm`)
    : null;

  const spawnEnv = buildArtifactRevealEnv(recording, {
    repoRoot: root,
    cwd,
    artifactDir,
    artifactFile,
    manifestPath,
    recordingMode: mode,
    screencastOutput,
    env: {
      ...env,
      DEMO_OUTPUT_DIR: outDir,
      CONSTRUCT_DEMO: name,
      CI: env.CI || '',
    },
  });

  const spawnTimeout = timeout || recording.timeout || 600_000;
  const run = runPlaywrightDemoTests({
    workspace,
    repoRoot: root,
    config,
    spec,
    env: spawnEnv,
    manifestPath,
    project: recording.project || null,
    recordingMode: mode,
    timeout: spawnTimeout,
  });

  if (!run.ok) {
    return attachDemoOutcome({ name, message: run.message }, { cwd, name, state: 'failed' });
  }

  const manifest = readArtifactManifest(manifestPath);
  const sourcePath = selectPrimaryVideoArtifact(manifest, { recordingMode: mode });
  const finalized = finalizeDemoVideo({ sourcePath, outputPath: destPath, format: outFormat });
  if (!finalized.ok) {
    return attachDemoOutcome({ name, message: finalized.message }, { cwd, name, state: 'degraded' });
  }

  attachRecordingAnnotations({
    demoName: name,
    artifactPath: finalized.outputPath,
    engine: 'playwright',
    opts: { cwd, repoRoot },
  });

  return attachDemoOutcome({
    name,
    recordingMode: mode,
    outputDir: outDir,
    outputPath: finalized.outputPath,
    artifactPath: sourcePath,
    manifestPath,
    format: finalized.format,
    engine: finalized.engine,
    artifacts: manifest?.artifacts?.map((entry) => path.basename(entry.path)) || [],
    message: `Recorded Playwright demo (${mode}) to ${finalized.outputPath}`,
  }, { cwd, name, state: 'recorded', artifactPath: finalized.outputPath });
}
