import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "../components/layout/ThemeToggle";
import { THEME_STORAGE_KEY, readStoredTheme, useTheme } from "./useTheme";

function stubSystemTheme(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("dark") ? dark : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function Harness() {
  const { theme, toggle } = useTheme();
  return <ThemeToggle theme={theme} onToggle={toggle} />;
}

describe("тема оформления", () => {
  afterEach(() => localStorage.clear());

  it("по умолчанию следует системной настройке: тёмная", () => {
    stubSystemTheme(true);
    render(<Harness />);
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    expect(screen.getByRole("button", { name: "Тёмная тема" })).toHaveAttribute("aria-pressed", "true");
  });

  it("по умолчанию следует системной настройке: светлая", () => {
    stubSystemTheme(false);
    render(<Harness />);
    expect(document.documentElement.dataset["theme"]).toBe("light");
    expect(screen.getByRole("button", { name: "Тёмная тема" })).toHaveAttribute("aria-pressed", "false");
  });

  it("переключение сохраняется в localStorage по ключу compass-theme", async () => {
    stubSystemTheme(false);
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Тёмная тема" }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(THEME_STORAGE_KEY).toBe("compass-theme");
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    await user.click(screen.getByRole("button", { name: "Тёмная тема" }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("сохранённый выбор важнее системной темы и переживает перемонтирование", () => {
    stubSystemTheme(true);
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    expect(readStoredTheme()).toBe("light");
    render(<Harness />);
    expect(document.documentElement.dataset["theme"]).toBe("light");
  });

  it("игнорирует мусор в хранилище", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "розовая");
    expect(readStoredTheme()).toBeNull();
  });
});
