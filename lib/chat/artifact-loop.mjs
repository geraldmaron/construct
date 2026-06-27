/**
 * lib/chat/artifact-loop.mjs — Chat-surface wrapper for the artifact loop.
 *
 * Drives the model to draft a typed artifact, renders route/gate output to the
 * TUI, and delegates intent resolution + materialization to artifact-loop-core.
 */
import { validateArtifactBody, dedupeGateErrors } from '../artifact-release-gate.mjs';
import { findConstructRoot } from '../artifact-manifest.mjs';
import { buildPlanContext } from './session-context.mjs';
import { planTurn } from './transparency.mjs';
import { createTurnBlock, applyOverlayToTurn } from './tui/turn-block.mjs';
import { routeLabelColumn } from './present.mjs';
import { markdownToPlain } from './tui/markdown.mjs';
import { renderSectionLabel, renderAssistantLabel } from './tui/terminal-chrome.mjs';
import { formatPathLink, terminalLinksEnabled } from './tui/terminal-links.mjs';
import { termWidth } from '../term-format.mjs';
import { formatUserFacingError } from './user-error.mjs';
import {
  resolveArtifactLoopRequest, buildArtifactAuthoringPrompt, extractArtifactMarkdown,
  ensureFrontmatter, runConstructArtifactLoop, lastAssistantBody,
} from '../artifact-loop-core.mjs';

export {
  lastAssistantBody, lastUserBody, hasSubstantialDraft, resolveArtifactLoopRequest,
  detectConstructLoopIntent, resolveLoopArtifactType, buildArtifactAuthoringPrompt,
  normalizeDraftMarkdown, extractArtifactMarkdown, runConstructArtifactLoop,
} from '../artifact-loop-core.mjs';

const MAX_AUTHOR_GATE_ATTEMPTS = 2;

export async function runArtifactLoopChatTurn({
  text,
  turnBlocks = [],
  cwd = process.cwd(),
  rootDir,
  explicit = false,
  driver,
  layers,
  output,
  colors,
  env = process.env,
  persist = null,
  session = null,
  plain = false,
  renderRoutePhase,
  renderTurnWithFallback,
} = {}) {
  const request = resolveArtifactLoopRequest(text, { turnBlocks, explicit });
  if (!request) return null;

  const root = rootDir || findConstructRoot(cwd);
  let draftMarkdown = null;
  let generatedAssistant = null;
  let routeOverlay = null;

  if (request.mode === 'author') {
    if (!driver) {
      return {
        request,
        error: 'Artifact authoring requires a model driver. Describe the document in chat first, then run `/loop`.',
      };
    }
    if (!renderTurnWithFallback) {
      const mod = await import('./tui/render.mjs');
      renderTurnWithFallback = mod.renderTurnWithFallback;
    }
    const authoringText = buildArtifactAuthoringPrompt({
      userText: text,
      artifactType: request.artifactType,
      rootDir: root,
    });
    const planContext = buildPlanContext({ session, cwd, turnBlocks, text: authoringText });
    routeOverlay = await planTurn(authoringText, { env, context: planContext });
    if (renderRoutePhase) {
      const previewTurn = createTurnBlock(text);
      if (routeOverlay) applyOverlayToTurn(previewTurn, routeOverlay);
      renderRoutePhase(output, colors, previewTurn, layers, { width: termWidth(output), plain });
    }
    if (output) {
      output.write(`${colors?.dim || ''}  drafting artifact via model…${colors?.reset || ''}\n`);
    }

    let gateErrors = [];
    for (let attempt = 0; attempt < MAX_AUTHOR_GATE_ATTEMPTS; attempt++) {
      const promptText = buildArtifactAuthoringPrompt({
        userText: text,
        artifactType: request.artifactType,
        rootDir: root,
        gateErrors,
      });
      const genResult = await renderTurnWithFallback({
        driver,
        text: promptText,
        layers,
        output,
        colors,
        env,
        persist: attempt === 0 ? persist : null,
        session,
        cwd,
        turnBlocks,
        plain,
        promptOptions: {
          turnOverlay: routeOverlay,
          model: session?.model,
          permissionMode: session?.permissionMode,
          sandbox: session?.sandbox,
          skipUserRender: true,
          skipRouteRender: true,
        },
      });
      if (genResult.error || genResult.stopReason === 'error') {
        return {
          request,
          error: formatUserFacingError(genResult.error) || 'Model failed to draft the artifact. Check /model and try again.',
          routeOverlay,
        };
      }
      generatedAssistant = genResult.assistant || genResult.turn?.assistant || null;
      draftMarkdown = extractArtifactMarkdown(generatedAssistant);
      if (!draftMarkdown) {
        return {
          request,
          error: 'Model did not return a draft document with a # title. Check /model and try again.',
          routeOverlay,
          generatedAssistant,
        };
      }
      const preview = validateArtifactBody({
        body: ensureFrontmatter(draftMarkdown, request.artifactType),
        type: request.artifactType,
        cwd,
        rootDir: root,
      });
      if (preview.ok) break;
      gateErrors = dedupeGateErrors(preview.errors);
      if (attempt === MAX_AUTHOR_GATE_ATTEMPTS - 1) {
        draftMarkdown = extractArtifactMarkdown(generatedAssistant);
      }
    }
  } else {
    const planContext = buildPlanContext({ session, cwd, turnBlocks, text });
    routeOverlay = await planTurn(text, { env, context: planContext });
    if (renderRoutePhase) {
      const turn = createTurnBlock(text);
      if (routeOverlay) applyOverlayToTurn(turn, routeOverlay);
      renderRoutePhase(output, colors, turn, layers, { width: termWidth(output), plain });
    }
    draftMarkdown = extractArtifactMarkdown(lastAssistantBody(turnBlocks));
    if (!draftMarkdown) {
      return {
        request,
        error: 'No draft in chat to validate. Draft the document first or use `/loop <subject>`.',
        routeOverlay,
      };
    }
  }

  const loopResult = await runConstructArtifactLoop({
    text,
    turnBlocks,
    cwd,
    rootDir: root,
    explicit,
    artifactType: request.artifactType,
    draftMarkdown,
    allowScaffold: false,
  });

  if (loopResult.draftMissing) {
    return {
      request,
      error: 'No draft content to materialize.',
      routeOverlay,
      generatedAssistant,
      loopResult,
    };
  }

  return {
    request,
    loopResult,
    routeOverlay,
    generatedAssistant,
    turn: {
      userText: text,
      assistant: generatedAssistant
        ? `${generatedAssistant}\n\n${loopResult.summary}`
        : loopResult.summary,
    },
  };
}

export function writeArtifactLoopReport(output, colors, result, { cwd = process.cwd(), env = process.env, plain = false } = {}) {
  const linksEnabled = terminalLinksEnabled(env, { plain, stream: output });
  renderSectionLabel(output, colors, 'ARTIFACT LOOP', { tint: 'brandAccent', glyph: '◆' });
  const wrote = formatPathLink(result.relPath, colors, { cwd, enabled: linksEnabled });
  const rows = [
    { label: 'workflow', value: `${result.workflowType}  ${colors.dim}type${colors.reset}  ${result.artifactType}` },
    { label: 'wrote', value: wrote },
  ];
  if (result.invokePlan?.selectedRoles?.length) {
    const chain = result.invokePlan.selectedRoles.map((r) => `cx-${r}`).join(' → ');
    rows.push({ label: 'plan', value: chain });
  }
  const gateColor = result.validation?.ok ? colors.ok : colors.red;
  rows.push({
    label: 'gate',
    value: `${gateColor}${result.validation?.ok ? 'PASS' : 'FAIL'}${colors.reset}`,
  });
  const labelCol = routeLabelColumn(rows);
  for (const row of rows) {
    output.write(`${colors.dim}  │ ${row.label.padEnd(labelCol)}${colors.reset} ${row.value}\n`);
  }
  if (!result.validation?.ok && result.validation?.errors?.length) {
    const uniqueErrors = dedupeGateErrors(result.validation.errors);
    output.write(`${colors.dim}  │ ${'errors'.padEnd(labelCol)}${colors.reset} ${uniqueErrors.length}\n`);
    for (const err of uniqueErrors.slice(0, 8)) {
      output.write(`${colors.red}  │   - ${err}${colors.reset}\n`);
    }
    if (result.validation.errors.length > 8) {
      output.write(`${colors.dim}  │   … and ${uniqueErrors.length - 8} more${colors.reset}\n`);
    }
  }
  if (result.validation?.warnings?.length) {
    for (const w of result.validation.warnings.slice(0, 3)) {
      output.write(`${colors.yellow}  │ warn: ${w}${colors.reset}\n`);
    }
  }
  output.write('\n');
  renderAssistantLabel(output, colors, { plain: !colors.highlight });
  const width = termWidth(output);
  for (const line of markdownToPlain(result.summary, { width }).split('\n')) {
    output.write(`${colors.dim}  │${colors.reset} ${line}\n`);
  }
  output.write('\n');
}
