import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "compass-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function subscribeSystem(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const getSystemTheme = (): Theme =>
  typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches ? "dark" : "light";

/** Тема: сохранённый выбор (localStorage) важнее системной настройки. */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [stored, setStored] = useState<Theme | null>(readStoredTheme);
  const system = useSyncExternalStore(subscribeSystem, getSystemTheme, () => "light" as const);
  const theme = stored ?? system;

  useEffect(() => {
    document.documentElement.dataset["theme"] = theme;
  }, [theme]);

  const toggle = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setStored(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* хранилище недоступно — тема действует до перезагрузки */
    }
  }, [theme]);

  return { theme, toggle };
}
