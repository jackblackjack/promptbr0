import { describe, expect, it } from "vitest";
import { assemblePromptContent } from "./blocks.js";

describe("assemblePromptContent", () => {
  const blocks = [
    { id: "a", content: "Stay terse.", isActive: true },
    { id: "b", content: "  padded \n\n ", isActive: false },
  ];

  it("appends only default-active blocks on their own lines, verbatim", () => {
    expect(assemblePromptContent("Base", blocks)).toBe("Base\nStay terse.");
  });

  it("appends inactive blocks when overridden and skips overridden-off actives", () => {
    expect(
      assemblePromptContent("Base", blocks, { a: false, b: true }),
    ).toBe("Base\n  padded \n\n ");
  });

  it("ignores unknown override ids and leaves the base untouched without actives", () => {
    expect(assemblePromptContent("Base", blocks, { ghost: true })).toBe("Base\nStay terse.");
    expect(assemblePromptContent("Base", [], { a: true })).toBe("Base");
  });
});
