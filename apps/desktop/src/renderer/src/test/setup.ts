/**
 * Global vitest setup (runs for every test file, node and jsdom alike).
 *
 * Node ≥22 ships an experimental `localStorage` global whose getter returns
 * `undefined` unless `--localstorage-file` is passed. Vitest's jsdom
 * environment refuses to override existing globals, so inside jsdom tests the
 * broken Node getter shadows jsdom's Storage and `localStorage` is undefined.
 * Reinstall a real Storage (from a scratch JSDOM) when running under jsdom.
 * Do not probe Node's getter: reading it is what emits the warning.
 */
import { JSDOM } from "jsdom";
import { beforeAll, vi } from "vitest";
import { initI18n } from "../lib/i18n";

if (typeof window !== "undefined") {
  const dom = new JSDOM("", { url: "https://localhost/" });
  Object.defineProperty(globalThis, "localStorage", {
    value: dom.window.localStorage,
    configurable: true,
    writable: true,
  });

  // jsdom has no DragEvent, so Testing Library falls back to a plain Event and
  // silently drops `shiftKey`/`clientY`. A MouseEvent-based stand-in keeps the
  // drag-and-drop tests honest.
  if (!window.DragEvent) {
    class DragEventPolyfill extends MouseEvent {
      readonly dataTransfer: DataTransfer | null;

      constructor(type: string, init: DragEventInit = {}) {
        super(type, init);
        this.dataTransfer = init.dataTransfer ?? null;
      }
    }
    Object.defineProperty(window, "DragEvent", {
      value: DragEventPolyfill,
      configurable: true,
    });
  }
}

// Pre-load the English dictionary so t() returns English translations in tests.
// Since vitest runs tests serially in a single process and `initI18n` is
// idempotent, this is sufficient — no afterEach reset needed.
beforeAll(async () => {
  await initI18n("en");
});
