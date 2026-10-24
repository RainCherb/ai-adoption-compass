import { type ReactNode, useEffect, useRef, useState } from "react";
import type { Health } from "../../api/types";
import type { AsyncState } from "../../hooks/useAsync";
import type { Theme } from "../../hooks/useTheme";
import { ROUTES, type RouteId } from "../../lib/routes";
import { Icon } from "../ui/Icon";
import { Banner } from "../ui/Banner";
import { Logo } from "./Logo";
import { NavList } from "./NavList";
import { StatusChip } from "./StatusChip";
import { ThemeToggle } from "./ThemeToggle";

interface AppShellProps {
  route: RouteId;
  theme: Theme;
  onToggleTheme: () => void;
  health: AsyncState<Health>;
  children: ReactNode;
}

export function AppShell({ route, theme, onToggleTheme, health, children }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
  const current = ROUTES.find((item) => item.id === route);

  useEffect(() => {
    document.title = current ? `${current.label} · AI Adoption Compass` : "AI Adoption Compass";
  }, [current]);

  // После перехода фокус уходит в начало страницы, чтобы клавиатура и скринридер не «застревали» в меню.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo?.({ top: 0 });
  }, [route]);

  return (
    <div className="app">
      <a className="skip-link" href="#main" onClick={(event) => {
        event.preventDefault();
        mainRef.current?.focus();
      }}>
        К основному содержимому
      </a>

      <aside className="sidebar">
        <div className="sidebar__brand">
          <Logo />
        </div>
        <nav aria-label="Основная навигация">
          <NavList route={route} />
        </nav>
        <p className="sidebar__note">
          <Icon name="lock" size={14} />
          Данные не передаются провайдерам LLM. В публичном демо используйте только вымышленные примеры.
        </p>
      </aside>

      <div className="app__main">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn topbar__menu"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label="Меню"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon name={menuOpen ? "close" : "menu"} size={21} />
          </button>
          <div className="topbar__brand">
            <Logo />
          </div>
          <div className="topbar__spacer" />
          <StatusChip health={health} />
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </header>

        {menuOpen ? (
          <nav id="mobile-nav" className="mobile-nav" aria-label="Основная навигация">
            <NavList route={route} onNavigate={() => setMenuOpen(false)} />
          </nav>
        ) : null}

        <main id="main" ref={mainRef} className="content" tabIndex={-1}>
          {health.data?.demo_mode ? (
            <Banner tone="info" title="Публичное интерактивное демо">
              Только вымышленные данные. Ввод не сохраняется, LLM не вызываются. Качество и ROI — экспертные допущения.
            </Banner>
          ) : null}
          {children}
        </main>

        <footer className="footer">
          <span>AI Adoption Compass{health.data ? ` v${health.data.version}` : ""}</span>
          <span className="footer__sep" aria-hidden="true">
            ·
          </span>
          <span>Без внешних запросов и аналитики</span>
          <span className="footer__sep" aria-hidden="true">
            ·
          </span>
          <a href="/api/docs" target="_blank" rel="noreferrer">
            Документация API
          </a>
        </footer>
      </div>
    </div>
  );
}
