/**
 * cli/work.ts — headless operator entry for format-v1 projects.
 *
 * Interactive dispatch is MCP (InteractiveRunService). Home-store ambient
 * census / chooseResource dispatch is gone: without project init this verb
 * refuses. With init, claim / submit / status require an explicit pin.
 */

import { tryOpenProjectStore } from './project-store.ts';
import { workV1 } from './work-v1.ts';

export async function work(
  argv: string[],
  _hostOverride?: unknown,
  _probe?: unknown,
  _env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): Promise<number> {
  const opened = tryOpenProjectStore(cwd);
  if (!opened) {
    process.stderr.write(
      'work: requires an initialized project (`construct init`).\n' +
        'Interactive work is MCP next_work / submit_work in the host session.\n' +
        'Headless claim/submit/status needs --pin on that project.\n',
    );
    return 1;
  }
  try {
    return workV1(opened.store, argv);
  } finally {
    opened.store.close();
  }
}
