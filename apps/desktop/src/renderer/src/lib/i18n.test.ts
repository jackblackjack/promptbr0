import { afterAll, describe, expect, it } from "vitest";
import { initI18n, tCount } from "./i18n";

const modelKeys = {
  one: "model_picker.selected_one",
  few: "model_picker.selected_few",
  many: "model_picker.selected_many",
};

const wordKeys = {
  one: "main_pane.words_one",
  few: "main_pane.words_few",
  many: "main_pane.words_many",
};

const charKeys = {
  one: "main_pane.chars_one",
  few: "main_pane.chars_few",
  many: "main_pane.chars_many",
};

describe("tCount", () => {
  it("uses the English singular and plural forms", () => {
    expect(tCount(1, modelKeys)).toBe("1 model");
    expect(tCount(2, modelKeys)).toBe("2 models");
    expect(tCount(5, modelKeys)).toBe("5 models");
  });

  it("uses the Russian plural categories", async () => {
    await initI18n("ru");
    expect(tCount(1, modelKeys)).toBe("1 модель");
    expect(tCount(2, modelKeys)).toBe("2 модели");
    expect(tCount(5, modelKeys)).toBe("5 моделей");
    expect(tCount(21, modelKeys)).toBe("21 модель");
  });

  it("covers the editor word and character counters", async () => {
    await initI18n("en");
    expect(tCount(1, wordKeys)).toBe("1 word");
    expect(tCount(2, wordKeys)).toBe("2 words");
    expect(tCount(1, charKeys)).toBe("1 char");
    expect(tCount(2, charKeys)).toBe("2 chars");

    await initI18n("ru");
    expect(tCount(1, wordKeys)).toBe("1 слово");
    expect(tCount(2, wordKeys)).toBe("2 слова");
    expect(tCount(5, wordKeys)).toBe("5 слов");
    expect(tCount(1, charKeys)).toBe("1 символ");
    expect(tCount(2, charKeys)).toBe("2 символа");
    expect(tCount(5, charKeys)).toBe("5 символов");
  });
});

afterAll(async () => {
  await initI18n("en");
});
