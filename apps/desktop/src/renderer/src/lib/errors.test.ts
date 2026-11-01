import { describe, expect, it } from "vitest";
import { userErrorMessage } from "./errors";

describe("userErrorMessage", () => {
  it("removes Electron's remote-method wrapper from an actionable error", () => {
    expect(
      userErrorMessage(
        new Error(
          "Error invoking remote method 'ai-run:run': Error: Provider returned 401",
        ),
      ),
    ).toBe("Provider returned 401");
  });

  it("preserves ordinary error messages and string failures", () => {
    expect(userErrorMessage(new Error("Invalid provider URL"))).toBe("Invalid provider URL");
    expect(userErrorMessage("Timed out")).toBe("Timed out");
  });
});
