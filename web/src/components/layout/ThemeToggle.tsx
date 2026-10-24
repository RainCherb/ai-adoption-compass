import type { Theme } from "../../hooks/useTheme";
import { Icon } from "../ui/Icon";

interface ThemeToggleProps {
  theme: Theme;
  onToggle: () => void;
}

export function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  const dark = theme === "dark";
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={onToggle}
      aria-pressed={dark}
      aria-label="Тёмная тема"
      title={dark ? "Переключить на светлую тему" : "Переключить на тёмную тему"}
    >
      <Icon name={dark ? "moon" : "sun"} size={19} />
    </button>
  );
}
