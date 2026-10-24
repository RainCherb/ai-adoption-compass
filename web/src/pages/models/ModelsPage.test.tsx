import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { featuredComparison } from "../../test/featuredComparison";
import { mockFetch, reply } from "../../test/mockFetch";
import { ModelsPage } from "./ModelsPage";

describe("Основные зарубежные модели", () => {
  it("показывает три модели в заданном порядке и не выдаёт расчёт за тест качества", async () => {
    mockFetch([{ method: "POST", path: "/api/models/compare", reply: featuredComparison }]);
    render(<ModelsPage />);
    const list = await screen.findByRole("list", { name: "Основные зарубежные модели" });
    expect(within(list).getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Claude Sonnet 5.5", "GPT-6.1 Sol", "DeepSeek V4.1 Flash",
    ]);
    expect(screen.getByText(/Качество основных моделей ещё не измерено/)).toBeInTheDocument();
    expect(within(list).getByText("6,6 $")).toBeInTheDocument();
  });

  it("отправляет общую нагрузку и выбранный период, предупреждает о старом расчёте", async () => {
    const user = userEvent.setup();
    const mock = mockFetch([{ method: "POST", path: "/api/models/compare", reply: featuredComparison }]);
    render(<ModelsPage />);
    await screen.findByRole("list", { name: "Основные зарубежные модели" });
    await user.click(screen.getByRole("button", { name: "Изменить нагрузку" }));
    await user.clear(screen.getByLabelText("Запросов в месяц"));
    await user.type(screen.getByLabelText("Запросов в месяц"), "20000");
    await user.selectOptions(screen.getByLabelText("Период DeepSeek"), "off_peak");
    expect(screen.getByText(/Параметры изменены/)).toHaveTextContent("предыдущий расчёт");
    await user.click(screen.getByRole("button", { name: "Сравнить стоимость" }));
    await waitFor(() => expect(mock.calls.at(-1)?.body).toEqual({
      requests_per_month: 20000, tokens_in: 1000, tokens_out: 300, deepseek_period: "off_peak",
    }));
    expect(screen.queryByText(/Параметры изменены/)).not.toBeInTheDocument();
  });

  it("не отправляет пустые или недопустимые числа", async () => {
    const user = userEvent.setup();
    const mock = mockFetch([{ method: "POST", path: "/api/models/compare", reply: featuredComparison }]);
    render(<ModelsPage />);
    await screen.findByRole("list", { name: "Основные зарубежные модели" });
    await user.click(screen.getByRole("button", { name: "Изменить нагрузку" }));
    await user.clear(screen.getByLabelText("Входных токенов на запрос"));
    await user.click(screen.getByRole("button", { name: "Сравнить стоимость" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Введите целые числа");
    expect(mock.calls).toHaveLength(1);
  });

  it("не показывает стоимость без действующего ревью", async () => {
    const data = structuredClone(featuredComparison);
    data.models[0]!.available = false;
    data.models[0]!.monthly_usd = null;
    data.models[0]!.reason = "Источник требует повторного ревью; расчёт скрыт";
    mockFetch([{ method: "POST", path: "/api/models/compare", reply: data }]);
    render(<ModelsPage />);
    expect(await screen.findByText("Источник требует повторного ревью; расчёт скрыт")).toBeInTheDocument();
    expect(screen.getByText("Источник требует повторного ревью; расчёт скрыт")).toBeInTheDocument();
  });

  it("показывает ошибку API и даёт повторить запрос", async () => {
    mockFetch([{ method: "POST", path: "/api/models/compare", reply: reply(503, { detail: "Недоступно" }) }]);
    render(<ModelsPage />);
    expect(await screen.findByText("Не удалось получить тарифы")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeEnabled();
  });
});
