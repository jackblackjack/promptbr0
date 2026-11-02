import { describe, expect, it } from "vitest";

import { assertLibraryMainFrame } from "./ipc-sender-guard.js";

describe("assertLibraryMainFrame", () => {
  const mainFrame = {};
  const mainContents = { id: 11, mainFrame };
  const window = { webContents: mainContents };

  it("accepts the library window's main frame", () => {
    expect(() =>
      assertLibraryMainFrame({ sender: mainContents, senderFrame: mainFrame }, window),
    ).not.toThrow();
  });

  it("rejects a foreign sender (e.g. the quick palette), a subframe, and a missing window", () => {
    const paletteContents = { id: 12, mainFrame: {} };

    expect(() =>
      assertLibraryMainFrame(
        { sender: paletteContents, senderFrame: paletteContents.mainFrame },
        window,
      ),
    ).toThrow(/library window/i);
    expect(() =>
      assertLibraryMainFrame({ sender: mainContents, senderFrame: {} }, window),
    ).toThrow(/main frame/i);
    expect(() =>
      assertLibraryMainFrame({ sender: mainContents, senderFrame: mainFrame }, null),
    ).toThrow(/library window/i);
  });
});
