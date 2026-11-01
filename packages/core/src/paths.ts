import os from "node:os";
import path from "node:path";

export const DB_FILENAME = "library.db";
export const DB_ENV_VAR = "PROMPTBR0_DB";

/**
 * Resolves the shared library database path used by the desktop app and the
 * CLI. `PROMPTBR0_DB` overrides everything (tests, agents pointed at a scratch
 * library, debugging).
 *
 * Defaults:
 * - macOS:   ~/Library/Application Support/PromptBr0/library.db
 * - Linux:   $XDG_CONFIG_HOME/promptbr0/library.db (or ~/.config)
 * - Windows: %APPDATA%/PromptBr0/library.db
 *
 * `platform` and `home` are injectable purely for tests; callers use the
 * defaults.
 */
export function resolveDatabasePath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string {
  // A set-but-blank variable must not shadow the platform default.
  const override = env[DB_ENV_VAR]?.trim();
  if (override) return path.resolve(override);

  switch (platform) {
    case "darwin":
      return path.join(home, "Library", "Application Support", "PromptBr0", DB_FILENAME);
    case "win32": {
      const appData = env["APPDATA"] ?? path.join(home, "AppData", "Roaming");
      return path.join(appData, "PromptBr0", DB_FILENAME);
    }
    default: {
      const configHome = env["XDG_CONFIG_HOME"] ?? path.join(home, ".config");
      return path.join(configHome, "promptbr0", DB_FILENAME);
    }
  }
}
