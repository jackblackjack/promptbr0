import { afterAll, describe, expect, it } from "vitest";
import { initI18n } from "./i18n";
import { relativeTime } from "./time";

const NOW = Date.parse("2026-11-01T12:00:00Z");

describe("relativeTime", () => {
  it("formats English timestamps with Intl plural rules", () => {
    expect(relativeTime("2026-11-01T11:59:30Z", NOW)).toBe("now");
    expect(relativeTime("2026-11-01T11:58:00Z", NOW)).toBe("2 minutes ago");
    expect(relativeTime("2026-10-31T12:00:00Z", NOW)).toBe("yesterday");
    expect(relativeTime("not-a-date", NOW)).toBe("");
  });

  it("uses the active interface language", async () => {
    await initI18n("ru");
    expect(relativeTime("2026-11-01T11:58:00Z", NOW)).toBe("2 минуты назад");
    expect(relativeTime("2026-10-31T12:00:00Z", NOW)).toBe("вчера");
  });
});

afterAll(async () => {
  await initI18n("en");
});
