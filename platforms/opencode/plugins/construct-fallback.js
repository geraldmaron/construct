import { createConstructOpenCodePlugin } from "__CONSTRUCT_TOOLKIT_DIR__/lib/opencode-runtime-plugin.mjs";

export const ConstructFallbackPlugin = createConstructOpenCodePlugin({
  toolkitDir: process.env.CONSTRUCT_TOOLKIT_DIR || "__CONSTRUCT_TOOLKIT_DIR__",
});
