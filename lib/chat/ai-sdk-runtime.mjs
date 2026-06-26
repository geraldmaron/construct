/**
 * lib/chat/ai-sdk-runtime.mjs — One-time AI SDK runtime configuration for chat.
 *
 * Suppresses SDK warning logs and prevents default console.error dumps on
 * provider failures; construct surfaces user-facing errors through the TUI.
 */

let configured = false;

export function configureAiSdkRuntime() {
  if (configured) return;
  configured = true;
  globalThis.AI_SDK_LOG_WARNINGS = false;
}
