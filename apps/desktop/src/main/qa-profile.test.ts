import { describe, expect, it, vi } from "vitest";
import { applyQaUserDataOverride } from "./qa-profile.js";

describe("disposable QA profile override", () => {
  it("does nothing when the override is absent or blank", () => {
    const setPath = vi.fn();

    expect(applyQaUserDataOverride({ setPath }, {})).toBeNull();
    expect(applyQaUserDataOverride({ setPath }, { PROMPTBR0_QA_USER_DATA: "  " })).toBeNull();
    expect(setPath).not.toHaveBeenCalled();
  });

  it("sets an absolute isolated userData path", () => {
    const setPath = vi.fn();

    expect(
      applyQaUserDataOverride(
        { setPath },
        { PROMPTBR0_QA_USER_DATA: "/private/tmp/promptbr0-qa/user-data" },
      ),
    ).toBe("/private/tmp/promptbr0-qa/user-data");
    expect(setPath).toHaveBeenCalledWith("userData", "/private/tmp/promptbr0-qa/user-data");
  });

  it("rejects relative paths before Electron reads userData", () => {
    const setPath = vi.fn();

    expect(() =>
      applyQaUserDataOverride({ setPath }, { PROMPTBR0_QA_USER_DATA: "qa/user-data" }),
    ).toThrow("PROMPTBR0_QA_USER_DATA must be an absolute path");
    expect(setPath).not.toHaveBeenCalled();
  });
});
