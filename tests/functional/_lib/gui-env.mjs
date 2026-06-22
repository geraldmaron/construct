/**
 * tests/functional/_lib/gui-env.mjs — headless-CI-safe GUI env for desktop/chat tests.
 *
 * Linux CI runners have no real display; tests that exercise desktop-surface
 * routing pass these vars so hasGuiDisplay() resolves like a GUI workstation.
 */

export const GUI_TEST_ENV = Object.freeze({
  DISPLAY: ':0',
  CX_CHAT_NO_DISPLAY: '0',
});
