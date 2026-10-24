import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { meta, processResults } from "../../test/fixtures";
import { QuadrantChart } from "./QuadrantChart";

const quadrantLabels = {
  quick_win: "Быстрая победа",
  strategic: "Стратегический проект",
  fill_in: "Попутная задача",
  postpone: "Отложить",
  blocked: "Нет допустимой модели",
};

function setup(onSelect = vi.fn(), selectedId: string | null = null) {
  render(
    <QuadrantChart
      processes={processResults}
      thresholds={{ ease: meta.thresholds["ease"] ?? 50, impact: meta.thresholds["impact"] ?? 50 }}
      quadrantLabels={quadrantLabels}
      selectedId={selectedId}
      onSelect={onSelect}
    />,
  );
  return onSelect;
}

describe("QuadrantChart", () => {
  it("рисует по пузырьку на каждый процесс и подписывает диаграмму", () => {
    setup();
    expect(screen.getAllByTestId("chart-point")).toHaveLength(processResults.length);
    const chart = screen.getByTestId("quadrant-chart");
    expect(chart).toHaveAccessibleName("Матрица «эффект — лёгкость внедрения»");
    expect(chart).toHaveAccessibleDescription(/Диаграмма из 3 процессов/);
  });

  it("проводит две пороговые линии по значениям из /api/meta", () => {
    setup();
    const ease = screen.getByTestId("threshold-ease");
    const impact = screen.getByTestId("threshold-impact");
    // вертикальная линия: x1 == x2, горизонтальная: y1 == y2
    expect(ease.getAttribute("x1")).toBe(ease.getAttribute("x2"));
    expect(impact.getAttribute("y1")).toBe(impact.getAttribute("y2"));
    expect(screen.getAllByText("порог 50")).toHaveLength(2);
  });

  it("цвет квадранта дополнен подписью: у каждого пузырька доступное имя с названием квадранта", () => {
    setup();
    const points = screen.getAllByTestId("chart-point");
    expect(points[0]).toHaveAccessibleName(/Быстрая победа/);
    expect(points.map((point) => point.getAttribute("data-quadrant")).sort()).toEqual(["blocked", "quick_win", "strategic"]);
  });

  it("клик по пузырьку сообщает выбранный процесс", async () => {
    const user = userEvent.setup();
    const onSelect = setup();
    await user.click(screen.getByRole("button", { name: /Разбор входящих счетов/ }));
    expect(onSelect).toHaveBeenCalledWith("p2");
  });

  it("выбор доступен с клавиатуры: Enter и Пробел", async () => {
    const user = userEvent.setup();
    const onSelect = setup();
    const point = screen.getByRole("button", { name: /Маршрутизация обращений/ });
    point.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenNthCalledWith(1, "p1");
  });

  it("по наведению и фокусу показывает подсказку с названием и ключевыми цифрами", async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.queryByTestId("chart-tooltip")).toBeNull();
    await user.hover(screen.getByRole("button", { name: /Маршрутизация обращений/ }));
    const tooltip = screen.getByTestId("chart-tooltip");
    expect(within(tooltip).getByText("Маршрутизация обращений")).toBeInTheDocument();
    expect(tooltip).toHaveTextContent("Лёгкость 84 · эффект 98");
    await user.unhover(screen.getByRole("button", { name: /Маршрутизация обращений/ }));
    expect(screen.queryByTestId("chart-tooltip")).toBeNull();
    await user.tab();
    expect(screen.getByTestId("chart-tooltip")).toBeInTheDocument();
  });

  it("выбранный процесс помечен (aria-pressed и кольцо)", () => {
    setup(vi.fn(), "p2");
    expect(screen.getByRole("button", { name: /Разбор входящих счетов/ })).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelectorAll(".qpoint__ring")).toHaveLength(1);
  });
});
