import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { evalDemo } from "../../test/fixtures";
import { mockFetch } from "../../test/mockFetch";
import { renderWithMeta } from "../../test/render";
import { pickHighlights } from "./ComparisonTable";
import { CLI_SNIPPET, EvalsPage } from "./EvalsPage";

function setup() {
  const api = mockFetch([{ path: "/api/evals/demo", reply: evalDemo }]);
  renderWithMeta(<EvalsPage initialMode="simulated" />);
  return api;
}

const rowOf = (provider: string) =>
  screen.getAllByTestId("eval-row").find((row) => within(row).queryByText(provider, { selector: "code" })) as HTMLElement;

describe("pickHighlights", () => {
  it("самая дешёвая — среди моделей: бесплатный baseline не в счёт, как и прогон без стоимости", () => {
    const [baseline, economy, flagship] = evalDemo.reports;
    const unknown = { ...economy!, provider: "api:x", cost_rub: null };
    expect(pickHighlights([baseline!, economy!, flagship!])).toEqual({ best: "sim:flagship", cheapest: "sim:economy" });
    expect(pickHighlights([baseline!, unknown, flagship!])).toEqual({ best: "sim:flagship", cheapest: "sim:flagship" });
    expect(pickHighlights([])).toEqual({ best: null, cheapest: null });
  });
});

describe("EvalsPage", () => {
  it("строит таблицу сравнения и подсвечивает лучшую точность и самый дешёвый прогон", async () => {
    setup();
    expect(await screen.findAllByTestId("eval-row")).toHaveLength(3);
    expect(within(rowOf("sim:flagship")).getByText("лучшая точность")).toBeInTheDocument();
    expect(within(rowOf("sim:economy")).getByText("самая дешёвая")).toBeInTheDocument();
    expect(within(rowOf("baseline:keywords")).queryByText("самая дешёвая")).toBeNull();
    expect(within(rowOf("baseline:keywords")).getByText("правила")).toBeInTheDocument();
    expect(within(rowOf("sim:economy")).getByText("симуляция")).toBeInTheDocument();

    const flagship = within(rowOf("sim:flagship"));
    expect(flagship.getByText("97,0 %")).toBeInTheDocument();
    expect(flagship.getByText("+22,0 п.п.")).toBeInTheDocument();
    expect(flagship.getByText("443 мс")).toBeInTheDocument();
  });

  it("явно предупреждает, что sim:* — симуляция, а baseline — правила", async () => {
    setup();
    await screen.findAllByTestId("eval-row");
    const note = screen.getByText("Это демонстрационный прогон, а не замер реальных моделей").closest(".banner") as HTMLElement;
    expect(within(note).getByText("sim:*")).toBeInTheDocument();
    expect(note).toHaveTextContent("детерминированная симуляция");
    expect(note).toHaveTextContent("baseline:keywords");
  });

  it("по умолчанию разбирает лучшую модель; клик по строке показывает её матрицу ошибок, классы и промахи", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findAllByTestId("eval-row");
    const detail = () => within(screen.getByTestId("provider-detail"));
    expect(detail().getByRole("heading", { name: /Разбор: sim:flagship/ })).toBeInTheDocument();
    const diagonal = () => screen.getAllByRole("cell").filter((c) => c.classList.contains("confusion__cell--hit")).map((c) => c.textContent);
    expect(diagonal()).toEqual(["4", "4"]);

    await user.click(within(rowOf("sim:economy")).getByRole("button"));
    expect(detail().getByRole("heading", { name: /Разбор: sim:economy/ })).toBeInTheDocument();
    expect(diagonal()).toEqual(["3", "2"]);
    // оси матрицы подписаны названиями классов из task.labels
    const matrix = within(screen.getByRole("table", { name: /Матрица ошибок/ }));
    expect(matrix.getByRole("rowheader", { name: "Оплата и счета" })).toBeInTheDocument();
    expect(matrix.getByRole("columnheader", { name: "Доставка" })).toBeInTheDocument();

    const perClass = within(screen.getByTestId("per-class-table"));
    expect(perClass.getByRole("rowheader", { name: "Доставка" })).toBeInTheDocument();
    expect(perClass.getByText("50 %")).toBeInTheDocument();

    expect(screen.getByText(/Оплатил картой, но заказ не оплачен/)).toBeInTheDocument();
    expect(screen.getByText("нет валидного ответа")).toBeInTheDocument();
  });

  it("показывает копируемую команду для прогона на реальных моделях", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findAllByTestId("eval-row");
    expect(screen.getByTestId("cli-snippet")).toHaveTextContent("compass eval run -p baseline -p api --base-url https://… --model … --catalog-id …");
    const section = screen.getByRole("heading", { name: "Прогон на реальных моделях" }).closest("section") as HTMLElement;
    await user.click(within(section).getByRole("button", { name: "Копировать" }));
    await expect(navigator.clipboard.readText()).resolves.toBe(CLI_SNIPPET);
  });
});
