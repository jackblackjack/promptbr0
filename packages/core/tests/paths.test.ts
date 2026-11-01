import path from "node:path";
import { describe, expect, it } from "vitest";
import { DB_FILENAME, resolveDatabasePath } from "../src/paths.js";

const HOME = "/home/tester";

describe("resolveDatabasePath", () => {
  it("resolves to ~/Library/Application Support/PromptBr0 on macOS", () => {
    expect(resolveDatabasePath({}, "darwin", HOME)).toBe(
      path.join(HOME, "Library", "Application Support", "PromptBr0", DB_FILENAME),
    );
  });

  it("uses %APPDATA% on Windows when set", () => {
    expect(resolveDatabasePath({ APPDATA: "C:\\Users\\tester\\AppData\\Roaming" }, "win32", HOME)).toBe(
      path.join("C:\\Users\\tester\\AppData\\Roaming", "PromptBr0", DB_FILENAME),
    );
  });

  it("falls back to ~/AppData/Roaming on Windows when APPDATA is unset", () => {
    expect(resolveDatabasePath({}, "win32", HOME)).toBe(
      path.join(HOME, "AppData", "Roaming", "PromptBr0", DB_FILENAME),
    );
  });

  it("uses $XDG_CONFIG_HOME on Linux when set", () => {
    expect(resolveDatabasePath({ XDG_CONFIG_HOME: "/xdg" }, "linux", HOME)).toBe(
      path.join("/xdg", "promptbr0", DB_FILENAME),
    );
  });

  it("falls back to ~/.config on Linux when XDG_CONFIG_HOME is unset", () => {
    expect(resolveDatabasePath({}, "linux", HOME)).toBe(
      path.join(HOME, ".config", "promptbr0", DB_FILENAME),
    );
  });

  it("PROMPTBR0_DB overrides the platform default on every platform", () => {
    for (const platform of ["darwin", "linux", "win32"] as const) {
      expect(resolveDatabasePath({ PROMPTBR0_DB: "/tmp/scratch.db" }, platform, HOME)).toBe(
        path.resolve("/tmp/scratch.db"),
      );
    }
  });

  it("resolves a relative PROMPTBR0_DB against the cwd", () => {
    expect(resolveDatabasePath({ PROMPTBR0_DB: "scratch.db" }, "darwin", HOME)).toBe(
      path.resolve("scratch.db"),
    );
  });

  it("ignores a blank PROMPTBR0_DB", () => {
    expect(resolveDatabasePath({ PROMPTBR0_DB: "   " }, "linux", HOME)).toBe(
      path.join(HOME, ".config", "promptbr0", DB_FILENAME),
    );
  });
});
