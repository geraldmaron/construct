/**
 * lib/init/docs-interactive.mjs — interactive documentation lane selection for init.
 *
 * Drives the Packs / Individual docs / Skip menu and follow-up pack or lane
 * pickers. Non-interactive resolution lives in doc-lanes.mjs.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  DOC_LANES,
  LANE_ORDER,
  DOC_PACKS,
  DOC_PACK_ORDER,
  resolveNonInteractiveDocsLanes,
} from './doc-lanes.mjs';

export const DOCS_SETUP_MODE_OPTIONS = [
  {
    label: 'Packs',
    value: 'packs',
    description: 'Curated bundles of documentation lanes (lean, product, or full).',
  },
  {
    label: 'Individual docs',
    value: 'individual',
    description: 'Pick specific lanes (ADRs, RFCs, PRDs, runbooks, …) one by one.',
  },
  {
    label: 'Skip (docs folder only)',
    value: 'skip',
    description: 'Create docs/ with an index README and no lane templates.',
  },
];

export const DOCS_SETUP_MENU_INSTRUCTIONS = '↑↓ Navigate · Enter Select · Q Cancel';

export function buildDocsPackOptions() {
  return DOC_PACK_ORDER.map((id) => ({
    label: DOC_PACKS[id].title,
    value: id,
    description: DOC_PACKS[id].description,
    meta: `${DOC_PACKS[id].lanes.length} lanes`,
  }));
}

export function buildIndividualLaneOptions() {
  return LANE_ORDER.map((lane) => ({
    label: DOC_LANES[lane].title,
    value: lane,
    checked: false,
    description: DOC_LANES[lane].description,
  }));
}

/**
 * Resolve documentation lanes from interactive menus or explicit CLI flags.
 */
export async function resolveDocumentationSelection({
  target,
  skipInteractive,
  withReadmeFlag = false,
  withArchitectureFlag = false,
  docsPresetName = null,
  docsLanesArg = null,
  withDocsFlag = null,
  withAllDocsFlag = false,
  withAdrsFlag = false,
  withRfcsFlag = false,
  withRunbooksFlag = false,
  withPostmortemsFlag = false,
  selectOption,
  multiSelect,
  confirm,
}) {
  if (skipInteractive) {
    const lanes = resolveNonInteractiveDocsLanes({
      docsPresetName,
      docsLanesCsv: docsLanesArg ? docsLanesArg.split('=')[1] : null,
      withDocsCsv: withDocsFlag ? withDocsFlag.split('=')[1] : null,
      withAllDocs: withAllDocsFlag,
      withAdrs: withAdrsFlag,
      withRfcs: withRfcsFlag,
      withRunbooks: withRunbooksFlag,
      withPostmortems: withPostmortemsFlag,
    });

    return {
      lanes,
      withArchitecture: withArchitectureFlag,
      withReadme: withReadmeFlag || !fs.existsSync(path.join(target, 'README.md')),
      docsPreset: docsPresetName,
    };
  }

  let withReadme = withReadmeFlag;
  if (!withReadmeFlag && !fs.existsSync(path.join(target, 'README.md'))) {
    withReadme = await confirm('Create README.md? [Y/n] ');
  }

  let selectedLanes = [];
  let chosenPack = docsPresetName;

  if (docsPresetName || withAllDocsFlag || withDocsFlag || docsLanesArg
      || withAdrsFlag || withRfcsFlag || withRunbooksFlag || withPostmortemsFlag) {
    selectedLanes = resolveNonInteractiveDocsLanes({
      docsPresetName,
      docsLanesCsv: docsLanesArg ? docsLanesArg.split('=')[1] : null,
      withDocsCsv: withDocsFlag ? withDocsFlag.split('=')[1] : null,
      withAllDocs: withAllDocsFlag,
      withAdrs: withAdrsFlag,
      withRfcs: withRfcsFlag,
      withRunbooks: withRunbooksFlag,
      withPostmortems: withPostmortemsFlag,
    });
  } else {
    const mode = await selectOption({
      title: 'Documentation setup',
      instructions: DOCS_SETUP_MENU_INSTRUCTIONS,
      options: DOCS_SETUP_MODE_OPTIONS,
    });

    if (mode === 'packs') {
      const packId = await selectOption({
        title: 'Documentation packs',
        instructions: DOCS_SETUP_MENU_INSTRUCTIONS,
        options: buildDocsPackOptions(),
      });
      chosenPack = packId;
      selectedLanes = [...(DOC_PACKS[packId]?.lanes ?? [])];
    } else if (mode === 'individual') {
      selectedLanes = await multiSelect({
        title: 'Individual documentation lanes',
        instructions: 'Space toggles · Enter confirms · nothing is pre-selected',
        options: buildIndividualLaneOptions(),
      });
    }
  }

  let withArchitecture = withArchitectureFlag;
  if (!withArchitectureFlag && selectedLanes.length > 0) {
    withArchitecture = await confirm('Create docs/architecture.md? [y/N] ');
  }

  return {
    lanes: selectedLanes,
    withArchitecture,
    withReadme,
    docsPreset: chosenPack,
  };
}
