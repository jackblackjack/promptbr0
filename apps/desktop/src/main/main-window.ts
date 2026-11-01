export interface MainWindowPort {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  isVisible(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

export interface MainWindowLifecyclePort {
  webContents: { id: number };
}

export interface MainWindowClosedHandlerDeps<Window extends MainWindowLifecyclePort> {
  getMainWindow(): Window | null;
  onMainWindowClosed(senderId: number): void;
  onWindowClosed(): void;
  shouldQuit(): boolean;
  quit(): void;
}

/** Capture the renderer identity while its WebContents is still alive. */
export function createMainWindowClosedHandler<Window extends MainWindowLifecyclePort>(
  window: Window,
  deps: MainWindowClosedHandlerDeps<Window>,
): () => void {
  const senderId = window.webContents.id;
  return () => {
    const wasMainWindow = deps.getMainWindow() === window;
    if (wasMainWindow) deps.onMainWindowClosed(senderId);
    deps.onWindowClosed();
    if (wasMainWindow && deps.shouldQuit()) deps.quit();
  };
}

export function restoreOrCreateMainWindow(
  window: MainWindowPort | null,
  createWindow: () => void,
): void {
  if (!window || window.isDestroyed()) {
    createWindow();
    return;
  }
  // A hidden window is neither destroyed nor minimized: focus() alone would
  // leave it invisible (close-to-tray, second launch, macOS activate).
  if (!window.isVisible()) window.show();
  if (window.isMinimized()) window.restore();
  window.focus();
}

export interface MainWindowClosePort {
  hide(): void;
}

export interface MainWindowCloseHandlerDeps {
  isTrayEnabled(): boolean;
  isQuitting(): boolean;
  onHideToTray(): void;
}

/**
 * Intercepts a main-window close so the app keeps running in the system tray.
 * Real quits (menu, Cmd+Q, OS shutdown) set the quitting flag first and close
 * normally; a disabled tray keeps the platform's previous behaviour.
 */
export function createMainWindowCloseHandler<Window extends MainWindowClosePort>(
  window: Window,
  deps: MainWindowCloseHandlerDeps,
): (event: { preventDefault(): void }) => void {
  return (event) => {
    if (deps.isQuitting() || !deps.isTrayEnabled()) return;
    event.preventDefault();
    window.hide();
    deps.onHideToTray();
  };
}

export function shouldQuitWhenMainWindowCloses(platform: NodeJS.Platform): boolean {
  return platform !== "darwin";
}
