import { afterEach, describe, expect, it, vi } from "vitest";
import { getLanguage, t } from "./i18n.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Studio localization", () => {
  it("uses Russian when no preference exists", () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    expect(getLanguage()).toBe("ru");
    expect(t("Settings")).toBe("Настройки");
    expect(t("Build Targets")).toBe("Цели сборки");
  });

  it("keeps canonical English strings in English mode", () => {
    vi.stubGlobal("localStorage", { getItem: () => "en" });
    expect(getLanguage()).toBe("en");
    expect(t("Settings")).toBe("Settings");
  });

  it("localizes parameterized runtime messages", () => {
    vi.stubGlobal("localStorage", { getItem: () => "ru" });
    expect(t("3 profiles ready")).toBe("3 профилей готово");
    expect(t('Delete "tutorial"?')).toBe("Удалить «tutorial»?");
    expect(t("6 strategy runs · inputs and outcomes")).toBe("6 запусков стратегий · входные данные и результаты");
  });
});
