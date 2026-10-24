import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { THEME_STORAGE_KEY } from "./hooks/useTheme";
import { advice, auditEvents, health, meta } from "./test/fixtures";
import { mockFetch, reply } from "./test/mockFetch";
import { featuredComparison } from "./test/featuredComparison";

function setup(overrides: { health?: unknown; meta?: unknown } = {}) {
  return mockFetch([
    { path: "/api/health", reply: overrides.health ?? health },
    { path: "/api/meta", reply: overrides.meta ?? meta },
    { path: "/api/assessments", reply: [] },
    { method: "POST", path: "/api/models/compare", reply: featuredComparison },
    { method: "POST", path: "/api/advice", reply: advice },
    { path: "/api/audit", reply: { events: auditEvents } },
  ]);
}

const nav = () => screen.getByRole("navigation", { name: "Основная навигация" });

function goTo(hash: string) {
  act(() => {
    window.location.hash = hash;
  });
}

describe("App: маршрутизация", () => {
  beforeEach(() => {
    window.location.hash = "#/assessment";
  });

  it("пустой URL открывает основные зарубежные модели", async () => {
    window.location.hash = "";
    setup();
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "Зарубежные модели" })).toBeInTheDocument();
    expect(within(nav()).getByRole("link", { name: "Зарубежные модели" })).toHaveAttribute("aria-current", "page");
  });

  it("по прямой ссылке открывает «Оценку процессов» и отмечает пункт меню aria-current", async () => {
    setup();
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "Оценка процессов" })).toBeInTheDocument();
    expect(within(nav()).getByRole("link", { name: "Оценка процессов" })).toHaveAttribute("aria-current", "page");
    expect(document.title).toBe("Оценка процессов · AI Adoption Compass");
  });

  it("в меню семь пунктов с русскими названиями и хеш-ссылками", async () => {
    setup();
    render(<App />);
    await screen.findByRole("heading", { level: 1 });
    const links = within(nav()).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Зарубежные модели",
      "Оценка процессов",
      "Подбор моделей",
      "Безопасность данных",
      "Промпты",
      "Качество моделей",
      "Журнал",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "#/models",
      "#/assessment",
      "#/advisor",
      "#/safety",
      "#/prompts",
      "#/evals",
      "#/audit",
    ]);
  });

  it("клик по пункту меню меняет хеш и страницу, фокус переходит к содержимому", async () => {
    const user = userEvent.setup();
    setup();
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Оценка процессов" });

    await user.click(within(nav()).getByRole("link", { name: "Подбор моделей" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Подбор моделей" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#/advisor");
    expect(within(nav()).getByRole("link", { name: "Подбор моделей" })).toHaveAttribute("aria-current", "page");
    expect(within(nav()).getByRole("link", { name: "Оценка процессов" })).not.toHaveAttribute("aria-current");
    expect(document.title).toBe("Подбор моделей · AI Adoption Compass");
    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("прямое изменение хеша (кнопки браузера, закладки) тоже переключает страницу", async () => {
    setup();
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Оценка процессов" });
    goTo("#/audit");
    expect(await screen.findByRole("heading", { level: 1, name: "Журнал" })).toBeInTheDocument();
    expect(await screen.findAllByTestId("audit-row")).toHaveLength(3);
  });

  it("при открытии по ссылке с хешем сразу показывает нужную страницу", async () => {
    window.location.hash = "#/safety";
    setup();
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "Безопасность данных" })).toBeInTheDocument();
  });

  it("неизвестный хеш ведёт на страницу по умолчанию", async () => {
    window.location.hash = "#/нет-такой-страницы";
    setup();
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "Зарубежные модели" })).toBeInTheDocument();
  });

  it("ссылка «К основному содержимому» не ломает хеш-маршрут", async () => {
    const user = userEvent.setup();
    setup();
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Оценка процессов" });
    goTo("#/audit");
    await screen.findByRole("heading", { level: 1, name: "Журнал" });
    await user.click(screen.getByRole("link", { name: "К основному содержимому" }));
    expect(window.location.hash).toBe("#/audit");
    expect(screen.getByRole("main")).toHaveFocus();
  });
});

describe("App: шапка и подвал", () => {
  beforeEach(() => {
    window.location.hash = "#/assessment";
  });

  it("чип показывает статус каталога из /api/health, подвал — версию", async () => {
    setup();
    render(<App />);
    const chip = await screen.findByTestId("catalog-status");
    expect(chip).toHaveTextContent("Каталог: демо-данные · 24.10.2026");
    expect(screen.getByRole("contentinfo")).toHaveTextContent("AI Adoption Compass v1.0.0");
  });

  it("если API недоступен, чип сообщает об этом, а страница — с кнопкой повтора", async () => {
    const user = userEvent.setup();
    let down = true;
    mockFetch([
      { path: "/api/health", handle: () => (down ? reply(503, { detail: "Хранилище недоступно" }) : health) },
      { path: "/api/meta", handle: () => (down ? reply(503, { detail: "Хранилище недоступно" }) : meta) },
      { path: "/api/assessments", reply: [] },
    ]);
    render(<App />);
    expect(await screen.findByText("API недоступен")).toBeInTheDocument();
    expect(await screen.findByText("Не удалось загрузить настройки сервиса")).toBeInTheDocument();

    down = false;
    await user.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Оценка процессов" })).toBeInTheDocument();
  });

  it("переключатель темы в шапке сохраняет выбор в localStorage и применяет data-theme", async () => {
    const user = userEvent.setup();
    setup();
    render(<App />);
    await screen.findByRole("heading", { level: 1 });
    const toggle = screen.getByRole("button", { name: "Тёмная тема" });
    const before = document.documentElement.dataset["theme"];
    await user.click(toggle);
    const after = before === "dark" ? "light" : "dark";
    expect(document.documentElement.dataset["theme"]).toBe(after);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(after);
    expect(toggle).toHaveAttribute("aria-pressed", String(after === "dark"));
  });

  it("мобильное меню открывается кнопкой, закрывается после выбора пункта", async () => {
    const user = userEvent.setup();
    setup();
    render(<App />);
    await screen.findByRole("heading", { level: 1 });
    const button = screen.getByRole("button", { name: "Меню" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByRole("navigation", { name: "Основная навигация" })).toHaveLength(1);

    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const navs = screen.getAllByRole("navigation", { name: "Основная навигация" });
    expect(navs).toHaveLength(2);

    await user.click(within(navs[1] as HTMLElement).getByRole("link", { name: "Журнал" }));
    await waitFor(() => expect(screen.getAllByRole("navigation", { name: "Основная навигация" })).toHaveLength(1));
    expect(await screen.findByRole("heading", { level: 1, name: "Журнал" })).toBeInTheDocument();
  });
});
