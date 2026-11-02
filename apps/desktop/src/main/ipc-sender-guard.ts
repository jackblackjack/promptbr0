// Duck-typed views of Electron's IpcMainInvokeEvent and BrowserWindow so the
// guard is unit-testable without a running Electron.
export interface IpcSenderEvent {
  sender: unknown;
  senderFrame: unknown;
}

export interface MainWindowWebContentsSource {
  webContents: { mainFrame: unknown };
}

/**
 * Renderer→main channels answer only the library window's main frame: the
 * quick-palette window has its own channel set, and any other sender (a
 * navigated subframe, a foreign webContents) must not be able to drive the
 * whole app through the preload bridge.
 */
export function assertLibraryMainFrame(
  event: IpcSenderEvent,
  mainWindow: MainWindowWebContentsSource | null,
): void {
  const mainFrame = mainWindow?.webContents.mainFrame;
  if (!mainWindow || !mainFrame || event.sender !== mainWindow.webContents) {
    throw new Error("IPC is only available to the library window.");
  }
  if (event.senderFrame !== mainFrame) {
    throw new Error("IPC is only available to the library window's main frame.");
  }
}
