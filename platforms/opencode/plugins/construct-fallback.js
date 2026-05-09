import { createConstructOpenCodePlugin } from "__CX_TOOLKIT_DIR__/lib/opencode-runtime-plugin.mjs";

export const ConstructFallbackPlugin = createConstructOpenCodePlugin({
  toolkitDir: process.env.CX_TOOLKIT_DIR || "__CX_TOOLKIT_DIR__",
});
